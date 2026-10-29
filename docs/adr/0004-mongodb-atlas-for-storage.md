# MongoDB Atlas for storage

Notes, Tasks, Runs, Users and Channel Identities are stored in MongoDB Atlas rather than the Postgres in the original sketch. The flexible document shape suits these records (a Run in particular is a nested record of stages that grows over time), and Atlas's free tier doesn't expire, unlike Render's free Postgres, which is deleted after 30 days.
