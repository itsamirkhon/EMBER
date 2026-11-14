from pipeline.build_corpus import build_claims, build_investigations, load_json, SEED_DIR, OUT_CORPUS

def test_quote_match_does_not_claim_scientific_verification():
    raw = {"id":"audit-claim", "sourceId":"src", "inv":None, "text":"A broad interpretation.", "quote":"The sample burned.", "topic":[]}
    claims = build_claims([raw], [], {}, {"src":{"text":"The sample burned."}})
    assert claims[0]["verificationStatus"] == "quote_checked"

def test_investigations_need_review_not_automatic_verified_status():
    rows = load_json(OUT_CORPUS)["tests"]
    invs = build_investigations(load_json(SEED_DIR / "investigations.json"), rows)
    assert all(inv["verificationStatus"] == "preliminary_team_reviewed" for inv in invs)
