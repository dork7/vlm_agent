# Observability is built in-house on MongoDB Runs

Each Voice Message's processing is recorded as one Run document in MongoDB (stage timings, model fallbacks, tool calls, errors) and shown on a dashboard rendered by the app itself, rather than adopting Langfuse, Grafana or another tracing service. For a single-owner bot this avoids running or paying for another service; revisit if Runs outgrow what a simple page can show.
