# 04: Lists

**What to build:** Select Tasks from the pool and group them into a named List (a draft until assigned); add or remove Tasks later. A Task already in a List can't be added to another, and the page says which List has it. Removed Tasks go back to the pool keeping their status. At most 50 Tasks per List. See spec story 8.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Selected Tasks become a named draft List, and leave the unassigned pool.
- [ ] Adding a Task that's in another List is refused, naming that List.
- [ ] A removed Task returns to the pool with its status unchanged.
- [ ] A 51st Task is refused.
- [ ] Each change is in `ta_events`; another owner's List is a 404.
