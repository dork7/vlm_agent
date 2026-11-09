# 15: Research

**What to build:** A User types or says something like "find out the VAT rate on exports" or "what did I note about the supplier?" and the bot looks it up and replies with a short answer and its sources, instead of saving a Note or Task. The classifier gains one more outcome, Research, carrying the question and whether the web is needed. The core searches the User's own Notes and Tasks by the question's words, then asks a model for the answer: through OpenRouter's web search plugin when the web is needed (OpenRouter models only), from the matches alone otherwise. The core emits a channel-neutral result carrying the answer, the web sources and the Headings of the User's items it used; the Telegram adapter formats it as one message. The Run takes the type `research`, with a `research` stage. See spec story 80 and **Research**.

**Blocked by:** 01, 02, 03

**Status:** ready-for-agent

- [x] Through Seam 1, a research message from a known User produces a processing-started event and then a result event with the model's answer and its web sources; no Note or Task is saved.
- [x] The web call goes to OpenRouter with the web search plugin; a question only about the User's own items makes no web call.
- [x] The User's matching Notes and Tasks are given to the model, and those its answer used are listed as sources; another User's never are.
- [x] A question only about the User's own items, with none matching, gets a plain "nothing found" reply without asking a model; one with matches falls back to the local model when every OpenRouter model fails.
- [x] At most five web pages are listed, and the Telegram reply fits one message without cutting a source short.
- [x] Every OpenRouter model failing (for a web question) gives the failure reply, and the Run is failed in its `research` stage with every attempt recorded.
- [x] The Run of a research message has the type `research` and a `research` stage recording the matches, whether the web was searched and the sources.
- [ ] Manually: asking the bot on Telegram to research something shows "processing…" edited into the answer and its links.
