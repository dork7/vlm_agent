# Inventory tools call the app's own /inventory routes over HTTP

The dummy Inventory API lives in the same app as the bot, yet the AI's tools reach it with real HTTP requests to a configured base URL and API key instead of calling its functions directly. This deliberately exercises the full "AI chooses a tool, then makes a fetch call" path, and means swapping in a real inventory system later is a configuration change (URL and key), not a code change. Don't "optimise" it into direct function calls.
