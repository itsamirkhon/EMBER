/**
 * Stage-bound protocol segment matcher.
 * Separates initial ignition/spread (seg-1) from flow-reduction extinction (seg-2..k),
 * operator termination (flow_shutoff / FT), and hot-flame extinction vs cool-flame continuation.
 */
import type {
  MatchedProtocolSegment,
  ProtocolStep,
  ResearchQuery,
  TargetEndpoint,
  Test,
  TestEvent,
} from './types';

const INITIAL_ENDPOINTS = new Set<TargetEndpoint>(['flame_establishment', 'sustained_spread', 'spread_rate']);
const FLOW_EXTINCTION_ENDPOINTS = new Set<TargetEndpoint>(['extinction_under_flow_change', 'quench_limit', 'blowoff_limit']);

export function isOperatorTerminated(test: Test): boolean {
  if (test.terminalEvent === 'flow_turned_off' || test.terminalEvent === 'FT') return true;
  return test.segments.some((seg) => seg.intervention === 'flow_shutoff');
}

const OPERATOR_EVENT_TYPES = new Set(['operator_flow_shutoff', 'flow_shutoff', 'flow_turned_off', 'ft']);

function precedes(earlier: ProtocolStep, later: ProtocolStep): boolean {
  if (earlier.order >= later.order) return false;
  // Absolute timing is optional; when present it must agree with protocol order.
  const earlierTime = earlier.timeEndS ?? earlier.timeStartS;
  const laterTime = later.timeStartS ?? later.timeEndS;
  return earlierTime === null || laterTime === null || earlierTime <= laterTime;
}

function eventSegment(test: Test, event: TestEvent): ProtocolStep | undefined {
  return test.segments.find((segment) => segment.segmentId === event.segmentId && segment.testId === event.testId);
}

function hasPrecedingBurn(test: Test, segment: ProtocolStep): boolean {
  return test.segments.some((prior) => prior.stageType === 'steady_burn' && precedes(prior, segment));
}

function matchesFlowIntervention(test: Test, event: TestEvent, segment: ProtocolStep): boolean {
  const intervention = event.endpoint === 'quench_limit' ? 'flow_stepped_down'
    : event.endpoint === 'blowoff_limit' ? 'flow_stepped_up' : null;
  return test.segments.some((step) =>
    (intervention ? step.intervention === intervention : step.stageType === 'flow_modification') &&
    (step.segmentId === segment.segmentId || precedes(step, segment)));
}

function isFlowEventConsistent(test: Test, event: TestEvent, segment: ProtocolStep): boolean {
  if (segment.stageType !== 'flow_modification' && segment.stageType !== 'termination') return false;
  if (!hasPrecedingBurn(test, segment)) return false;
  if (OPERATOR_EVENT_TYPES.has(event.eventType.toLowerCase())) return segment.intervention === 'flow_shutoff';
  return matchesFlowIntervention(test, event, segment);
}

function hasPrecedingHotExtinction(test: Test, segment: ProtocolStep): boolean {
  return test.events.some((prior) => {
    const hotSegment = eventSegment(test, prior);
    return prior.endpoint === 'hot_flame_extinction' && hotSegment !== undefined &&
      isEventConsistent(test, prior) && precedes(hotSegment, segment);
  });
}

function isSegmentTimingConsistent(test: Test, segment: ProtocolStep): boolean {
  if (segment.timeStartS !== null && segment.timeEndS !== null && segment.timeStartS > segment.timeEndS) return false;
  return !test.segments.some((prior) => prior.order < segment.order && !precedes(prior, segment));
}

function isEventConsistent(test: Test, event: TestEvent): boolean {
  if (test.events.filter((candidate) => candidate.id === event.id).length !== 1) return false;
  const segment = eventSegment(test, event);
  if (!segment || event.testId !== test.testId || !isSegmentTimingConsistent(test, segment)) return false;
  if (FLOW_EXTINCTION_ENDPOINTS.has(event.endpoint)) return isFlowEventConsistent(test, event, segment);
  if (event.endpoint === 'cool_flame_continuation') return hasPrecedingHotExtinction(test, segment);
  return true;
}

export function hasPhysicalFlowExtinction(test: Test): boolean {
  return test.events.some((event) => FLOW_EXTINCTION_ENDPOINTS.has(event.endpoint) &&
    !OPERATOR_EVENT_TYPES.has(event.eventType.toLowerCase()) &&
    event.observedValue.value !== 'flow_turned_off' && isEventConsistent(test, event));
}

export function hasCoolFlameContinuation(test: Test): boolean {
  return test.events.some((event) => event.endpoint === 'cool_flame_continuation' && isEventConsistent(test, event));
}

export function hasHotFlameExtinction(test: Test): boolean {
  return test.events.some((event) => event.endpoint === 'hot_flame_extinction' && isEventConsistent(test, event));
}

function findSegmentsForEndpoint(test: Test, endpoint: TargetEndpoint | null): {
  segments: ProtocolStep[];
  events: TestEvent[];
} {
  if (!endpoint) {
    return {
      segments: test.segments.slice(0, 1),
      events: test.events.slice(0, 2),
    };
  }
  const matchedEvents = test.events.filter((ev) => ev.endpoint === endpoint && isEventConsistent(test, ev));
  if (matchedEvents.length > 0) {
    const segIds = new Set(matchedEvents.map((e) => e.segmentId));
    const matchedSegments = test.segments.filter((s) => segIds.has(s.segmentId));
    return { segments: matchedSegments, events: matchedEvents };
  }

  if (INITIAL_ENDPOINTS.has(endpoint)) {
    const segs = test.segments.filter((s) => s.stageType === 'ignition' || s.stageType === 'steady_burn');
    return { segments: segs.length > 0 ? [segs[0]] : test.segments.slice(0, 1), events: [] };
  }

  if (FLOW_EXTINCTION_ENDPOINTS.has(endpoint)) {
    const segs = test.segments.filter((s) => s.stageType === 'flow_modification' || s.stageType === 'termination');
    return { segments: segs, events: [] };
  }

  return { segments: [], events: [] };
}

function matchesOperatorCutoff(test: Test, matchedEvents: TestEvent[]): boolean {
  if (matchedEvents.some((event) => OPERATOR_EVENT_TYPES.has(event.eventType.toLowerCase()))) return true;
  // Older records can describe the intervention as a step without an event.
  // A contradictory typed event must never be repaired by terminal text.
  if (test.events.some((event) => FLOW_EXTINCTION_ENDPOINTS.has(event.endpoint))) return false;
  return test.segments.some((segment) => segment.stageType === 'termination' && segment.intervention === 'flow_shutoff' &&
    hasPrecedingBurn(test, segment));
}

function evaluateEndpointMatch(
  endpoint: TargetEndpoint | null,
  queryFlowHistory: ResearchQuery['flowHistory'],
  test: Test,
  operatorTerminated: boolean,
  physicalFlowExt: boolean,
  coolFlamePresent: boolean,
  hotFlameExtinguished: boolean,
  matchedEvents: TestEvent[],
  matchedSegments: ProtocolStep[],
): { matched: boolean; outcomeLabel: string | null; warnings: string[] } {
  const warnings: string[] = [];

  if (operatorTerminated) {
    warnings.push('Test ended by operator flow shutoff (FT / flow_turned_off).');
  }
  if (coolFlamePresent) {
    warnings.push('Cool-flame combustion continued after hot-flame extinction (CFI/FLEX segment 2).');
  }

  if (!endpoint) {
    const label = matchedEvents[0]?.eventType ?? (test.initialOutcome || null);
    return { matched: test.initialOutcome !== 'not_applicable', outcomeLabel: label, warnings };
  }

  if (FLOW_EXTINCTION_ENDPOINTS.has(endpoint)) {
    if (operatorTerminated && !physicalFlowExt) {
      if (endpoint === 'extinction_under_flow_change' && queryFlowHistory === 'abrupt_cutoff') {
        return {
          matched: matchesOperatorCutoff(test, matchedEvents),
          outcomeLabel: 'flow_turned_off',
          warnings,
        };
      }
      warnings.push('Operator shutoff is NOT a physical quench or blowoff extinction limit.');
      return { matched: false, outcomeLabel: 'operator_flow_shutoff', warnings };
    }
    const ok = matchedEvents.length > 0 && physicalFlowExt;
    return {
      matched: ok,
      outcomeLabel: ok ? matchedEvents[0]?.eventType ?? test.terminalEvent ?? 'physical_flow_extinction' : null,
      warnings,
    };
  }

  if (endpoint === 'cool_flame_continuation') {
    return {
      matched: coolFlamePresent,
      outcomeLabel: coolFlamePresent ? 'cool_flame_continuation' : null,
      warnings,
    };
  }

  if (endpoint === 'hot_flame_extinction') {
    return {
      matched: hotFlameExtinguished,
      outcomeLabel: hotFlameExtinguished ? 'hot_flame_extinction' : null,
      warnings,
    };
  }

  if (INITIAL_ENDPOINTS.has(endpoint)) {
    if (test.initialOutcome === 'non_flaming_pyrolysis') {
      warnings.push('Non-flaming pyrolysis measures smoke generation below ignition; it does not measure flame establishment, sustained spread, or flame spread rate.');
      return { matched: false, outcomeLabel: null, warnings };
    }
    if (test.initialOutcome === 'not_applicable' || test.initialOutcome === 'unknown') {
      return { matched: false, outcomeLabel: null, warnings };
    }
    if (endpoint === 'spread_rate') {
      const hasRate = test.spreadRateMmS.value !== null || matchedEvents.length > 0;
      return {
        matched: hasRate,
        outcomeLabel: hasRate ? `${test.spreadRateMmS.value ?? matchedEvents[0]?.observedValue.value} mm/s` : null,
        warnings,
      };
    }
    return {
      matched: matchedSegments.length > 0 || matchedEvents.length > 0 || test.initialOutcome !== 'unknown',
      outcomeLabel: test.initialOutcome,
      warnings,
    };
  }

  // Remaining specific endpoints: burning_rate_constant, smoke_particle_size, smoke_point_length, suppressant_extinction
  const numericOk =
    (endpoint === 'burning_rate_constant' && test.burningRateMm2S.value !== null) ||
    (endpoint === 'smoke_particle_size' && test.particleSizeNm.value !== null) ||
    (endpoint === 'smoke_point_length' && test.smokePointLengthMm.value !== null) ||
    (endpoint === 'suppressant_extinction' &&
      (test.atmosphere.diluentPct.value !== null || test.segments.some((s) => s.intervention === 'n2_jet_applied' || s.intervention === 'suppressant_added')));

  const matched = matchedEvents.length > 0 || numericOk;
  return {
    matched,
    outcomeLabel: matched ? matchedEvents[0]?.eventType ?? endpoint : null,
    warnings,
  };
}

export function matchProtocolSegment(query: ResearchQuery, test: Test): MatchedProtocolSegment {
  const operatorTerminated = isOperatorTerminated(test);
  const physicalFlowExt = hasPhysicalFlowExtinction(test);
  const coolFlamePresent = hasCoolFlameContinuation(test);
  const hotFlameExtinguished = hasHotFlameExtinction(test);

  const { segments, events } = findSegmentsForEndpoint(test, query.targetEndpoint);
  const ep = evaluateEndpointMatch(
    query.targetEndpoint,
    query.flowHistory,
    test,
    operatorTerminated,
    physicalFlowExt,
    coolFlamePresent,
    hotFlameExtinguished,
    events,
    segments,
  );

  const inconsistentEvents = test.events.filter((event) => !isEventConsistent(test, event));
  if (inconsistentEvents.length > 0) {
    ep.warnings.push(`Inconsistent or unresolved event/segment chronology: ${inconsistentEvents.map((event) => event.id).join(', ')}. These events cannot support the endpoint.`);
  }
  if (segments.some((segment) => segment.timeStartS === null || segment.timeEndS === null)) {
    ep.warnings.push('Absolute event timing is unknown; only documented segment order is used.');
  }

  const flowHistoryMismatch =
    query.flowHistory !== null &&
    test.flow.history !== 'unknown' &&
    query.flowHistory !== test.flow.history;

  if (flowHistoryMismatch) {
    ep.warnings.push(`Flow history differs: query expects ${query.flowHistory}, test used ${test.flow.history}.`);
  }

  const segDesc = segments.map((s) => `${s.segmentId}(${s.stageType}:${s.intervention})`).join(' -> ');
  const segmentSummary = segDesc || `initial:${test.initialOutcome}${test.terminalEvent ? `, terminal:${test.terminalEvent}` : ''}`;

  return {
    matchedSegmentIds: segments.map((s) => s.segmentId),
    matchedEventIds: events.map((e) => e.id),
    endpointMatched: ep.matched,
    operatorTerminated,
    coolFlamePresent,
    hotFlameExtinguished,
    flowHistoryMismatch,
    segmentSummary,
    matchedOutcomeLabel: ep.outcomeLabel,
    warnings: ep.warnings,
  };
}

export function summarizeTestProtocol(test: Test): string {
  if (test.segments.length === 0) {
    return `${test.initialOutcome}${test.terminalEvent ? ` -> ${test.terminalEvent}` : ''}`;
  }
  return test.segments.map((s) => `${s.segmentId}[${s.stageType}:${s.intervention}]`).join(' -> ');
}
