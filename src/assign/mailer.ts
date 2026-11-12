export type Mail = { to: string; subject: string; text: string };
export type Mailer = { send(message: Mail): Promise<void> };
export function consoleMailer(): Mailer { return { async send(message) { console.log(message.text); } }; }
export function resendMailer(apiKey: string, from: string): Mailer {
  return { async send(message) {
    const response = await fetch("https://api.resend.com/emails", { method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: message.to, subject: message.subject, text: message.text }) });
    if (!response.ok) throw new Error(`Resend returned ${response.status}`);
  } };
}
