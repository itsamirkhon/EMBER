from ember.models import QueryConfig, ResearchQuery, Test


def q(endpoint="extinction_under_flow_reduction", **cfg):
    base = dict(material="PMMA", shape="rod", gravity_regime="microgravity")
    base.update(cfg)
    return ResearchQuery(question="t", endpoint=endpoint, config=QueryConfig(**base))


def mk_test(**kw) -> Test:
    d = dict(id="t_x", investigation_id="i", series="s", material="PMMA", phase="solid",
             geometry={"shape": "rod", "diameter_mm": {"kind": "reported", "value": 3.0, "unit": "mm"}},
             gravity={"regime": "microgravity", "platform": "ISS", "actual": True},
             flow={"direction": {"kind": "reported", "value": "opposed"}, "initial_velocity_cm_s": {"kind": "reported", "value": 10, "unit": "cm/s"},
                   "history_summary": "", "history_kind": "stepwise_reduction"},
             atmosphere={"o2_fraction": {"kind": "reported", "value": 0.21, "unit": "fraction", "role": "ambient"},
                         "pressure_kpa": {"kind": "reported", "value": 101.3, "unit": "kPa"}},
             protocol=[{"order": 1, "kind": "ignition", "description": "hot wire"}, {"order": 2, "kind": "flow_change", "description": "reduce flow"}],
             events=[{"kind": "final_extinction", "step_order": 2}], events_complete=True, substrate_confinement="free_standing")
    d.update(kw)
    return Test.model_validate(d)
