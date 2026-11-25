# OneDesk Privacy

Last updated: November 24, 2026

OneDesk opens, edits, and saves documents locally. Document editing does not
upload files to OneDesk. AI features require a network connection and send
requests only when you use them.

## Search reranking (off by default)

File search runs on this device: the index is built from your local files, is
queried locally, and is never uploaded. If you turn on **Jev search
reranking** in Settings, a search with two or more hits whose judgement is not
already cached also sends one request to the decision-model endpoint you
selected. That request contains:

- the query text
- up to 20 excerpts (at most 1,200 characters each), with each excerpt's file
  name and the name of its parent folder

Excerpts are document content, so they leave the device whenever reranking is
enabled. The request is capped at 24 KB and the reply at 1 MB; judgements are
cached in memory for 30 minutes. If the endpoint fails or times out, the local
ranking is used unchanged.

Selecting a local endpoint — Kev, Rizzo Flow, or a custom URL on this machine —
keeps that request on the device. A custom URL pointing at a server you host
sends the excerpts to that server instead of a vendor. Turning **Jev search
reranking** off stops these requests entirely.
