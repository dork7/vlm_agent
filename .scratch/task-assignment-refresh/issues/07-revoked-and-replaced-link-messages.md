# 07: Revoked and replaced link messages

**What to build:** An inactive link says which thing happened. Revoked: "This List has been revoked. Ask the person who sent it for a new link." Replaced because the List was reassigned: "This link has been replaced by a newer one." Neither shows any Task details. A stale open page that tries to act shows the same message instead of a raw 404. Deleting a List or a Person gives the revoked message. Spec stories 60–64.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Revoke and reassign produce different messages.
- [ ] No Task details appear on an inactive link.
- [ ] Action posts to an inactive link return the message, not a bare error.
- [ ] List or Person deletion shows the revoked message.
- [ ] Covered by tests through the existing HTTP workflow test seam.
