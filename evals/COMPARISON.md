# Eval 2026-08-21T05-00-47-935Z

- Provider: mock (mock-glimmer-v1)
- Dataset: dataset/v1/baseball.json (v1.0.0) — 20 cases
- Judge: unknown
- Accuracy: 45.0%  (partial 52.5%)
- Hallucination: 40.0%  Abstention: 0.0%  Grounded: 10.0%
- Weighted: 58.3%  Time-decayed: 46.1%
- CI95: [0.258, 0.658]  Bootstrap: [0.250, 0.650]
- Latency p50=0ms p95=1ms avg=0ms

## Weakest slices
- category:rules: 0.0% (2)
- category:live_season: 0.0% (1)
- category:trivia: 0.0% (1)
- team:unknown: 22.2% (9)
- freshness:static: 27.3% (11)
