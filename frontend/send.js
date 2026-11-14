/**
 * Deliver an inventory file straight to The Art of Books through the server.
 * Resolves to { sent, message }; never throws.
 */
export async function sendToAob(filename, content, passcode) {
  let response;
  try {
    response = await fetch('/api/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-passcode': passcode ?? '' },
      body: JSON.stringify({ filename, content }),
    });
  } catch {
    return { sent: false, message: 'No connection to the server. Check your signal and try again.' };
  }
  if (response.status === 401) return { sent: false, needsPasscode: true, message: 'Wrong or missing passcode.' };
  try {
    const body = await response.json();
    return { sent: body.sent === true, message: body.message ?? null };
  } catch {
    return { sent: false, message: `The server returned an error (${response.status}). Try again.` };
  }
}
