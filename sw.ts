const sw = self as unknown as ServiceWorkerGlobalScope;

addEventListener("install", () => {
  sw.skipWaiting();
});

addEventListener("activate", () => {
  sw.clients.claim();
  console.log("hello");
});

addEventListener("message", (event) => {
  console.log("service worker received message: ", event.data);
  if (event.data === null) console.log("null message received", event);

  const { msg } = event.data;
  switch (msg) {
    case "verify-listener":
      console.log("(handling event) service worker received verify-listener");
      break;
    case "stream":
      console.log("(handling event) service worker received stream");
      handleStream(event.data);
      break;
    case "frame":
      console.log("(handling event) service worker received stream");
      handleFrame(event.data);
      break;
    case "ser-frame":
      console.log("(handling event) service worker received ser-frame");
      handleSerFrame(event);
      break;
    default:
      throw new Error("Unexpected message: " + msg);
  }
});

async function handleFrame(eventData) {
  const { frame } = eventData;
  if (!frame) throw new Error("no frame received");

  console.log("service worker received frame: " + frame);
}

function handleSerFrame(event) {
  const { frame } = event.data;
  console.log("service worker received serialied frame: " + frame);

  event.ports[0].postMessage(frame, [frame.buffer.buffer]);
}

async function handleStream(eventData) {
  const { stream } = eventData;
  const reader = stream.getReader();

  // Reading the stream will throw a 'chunk could not be cloned'. The frame
  // is not closed and Chroem will show a 'VideoFrame was GC'd without being
  // closed' error.
  try {
    await reader.read();
    console.log("not expected to reach this code");
  } catch (err) {
    console.error("Expected error: ", err);
  }
}

async function readFrames(reader) {
  const { done, value } = await reader.read();
  if (done) return;
  console.log("service worker received stream chunk: " + value);
  value.close();
  readFrames(reader);
}
