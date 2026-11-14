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

export function hasPhysicalFlowExtinction(test: Test): boolean {
  if (test.terminalEvent === 'extinguished_at_reduced_flow' || test.terminalEvent === 'blowoff' || test.terminalEvent === 'SE') {
    return true;
  }
  return test.events.some(
    (ev) =>
      !OPERATOR_EVENT_TYPES.has(ev.eventType.toLowerCase()) &&
      ev.observedValue.value !== 'flow_turned_off' &&
      (ev.endpoint === 'quench_limit' ||
        ev.endpoint === 'blowoff_limit' ||
        ev.endpoint === 'extinction_under_flow_change'),
  );
}

export function hasCoolFlameContinuation(test: Test): boolean {
  if (test.events.some((ev) => ev.endpoint === 'cool_flame_continuation')) return true;
  if (test.segments.some((seg) => /cool[-\s]*flame/i.test(seg.description))) return true;
  return test.extra?.kCoolMm2S != null || test.extra?.DextCoolMm != null;
}

export function hasHotFlameExtinction(test: Test): boolean {
  if (test.events.some((ev) => ev.endpoint === 'hot_flame_extinction')) return true;
  return test.extra?.DextHotMm != null || /hot[-\s]*flame\s+extinct/i.test(test.outcomeRaw ?? '');
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
  const matchedEvents = test.events.filter((ev) => ev.endpoint === endpoint);
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
      if (queryFlowHistory === 'abrupt_cutoff') {
        const termSegs = matchedSegments.filter((s) => s.stageType === 'termination' || s.intervention === 'flow_shutoff');
        return {
          matched: termSegs.length > 0 || test.terminalEvent === 'flow_turned_off',
          outcomeLabel: 'flow_turned_off',
          warnings,
        };
      }
      warnings.push('Operator shutoff is NOT a physical quench or blowoff extinction limit.');
      return { matched: false, outcomeLabel: 'operator_flow_shutoff', warnings };
    }
    const ok = physicalFlowExt || matchedEvents.length > 0;
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
