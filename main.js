const image = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const registration = navigator.serviceWorker.register("./sw.js");
let generateVideoFrame;
function generateVideoFrameFactory(imageEl) {
    return async function generateVideoFrame() {
        const imageSource = imageEl;
        const videoFrame = new VideoFrame(imageSource, { timestamp: 0 });
        if (!videoFrame)
            throw new Error("could not create video frame");
        return videoFrame;
    };
}
navigator.serviceWorker.addEventListener("message", (event) => {
    console.log("received message", event);
});
document.addEventListener("DOMContentLoaded", async () => {
    const imageEl = document.getElementById("image");
    imageEl.addEventListener("load", async () => {
        generateVideoFrame = generateVideoFrameFactory(imageEl);
        main();
    });
    imageEl.setAttribute("src", image);
});
async function main() {
    let videoFrame = await generateVideoFrame();
    const transformer = new TransformStream();
    console.log("generated video frame", videoFrame);
    const writer = transformer.writable.getWriter();
    writer.write(videoFrame);
    writer.close();
    const sw = (await registration).active;
    // In Chrome, posting the readable stream works; the service worker receives the message
    // and errors out. See comments in `min-test-sw.js` (`handleStream`) for more details.
    try {
        sw.postMessage({ msg: "stream", stream: transformer.readable }, [
            transformer.readable,
        ]);
    }
    catch (err) {
        // Data clone error in Safari
        console.error("Expected error for Safari (posting stream)", err);
    }
    // Chrome will not show this message in the Service Worker. It does show a 'VideoFrame
    // was garbage collected' error in the console after a few seconds.
    //
    // Safari will show the message, but the `data` property on the event will be `null`.
    videoFrame = await generateVideoFrame();
    sw.postMessage({ msg: "frame", frame: videoFrame }, [videoFrame]);
    // This message does arrive, and does nothing (by design)
    sw.postMessage({ msg: "verify-listener" });
    videoFrame = await generateVideoFrame();
    // This will generate an empty object. Similarly, Object.entries and Object.getOwnPropertyNames
    // all return empty.
    const assignCopy = Object.assign({}, videoFrame);
    // Consequently, 'codedHeight' (and other properties) will be undefined
    if (typeof assignCopy.codedHeight === "undefined")
        console.error("Expected error: assignCopy.codedHeight is undefined");
    // This will work; see `serializableFrame` below
    const serFrame = await mostlySerializableFrame(videoFrame);
    videoFrame.close();
    try {
        // This fails because 'colorSpace' can't be cloned. It is also not transferable.
        sw.postMessage({ msg: "ser-frame", frame: serFrame }, [
            serFrame.buffer.buffer,
        ]);
    }
    catch (err) {
        if (err.name !== "DataCloneError")
            throw new Error("unexpected error", err);
        console.error("Expected error (cloning colorspace)", err);
    }
    // Re-encode the VideoColorSpace as a plain object. It seems like a simple enough interface.
    // https://www.w3.org/TR/webcodecs/#videocolorspace
    serFrame.meta.colorSpace = JSON.parse(JSON.stringify(serFrame.meta.colorSpace.toJSON()));
    // For verification, because VideoFrame is not available in the worker, we'll deserialize the frame here.
    const channel = new MessageChannel();
    channel.port1.onmessage = handleSerializedFrameEvent;
    // And finally post it to the worker again, with the JSON-serialized colorspace
    sw.postMessage({ msg: "ser-frame", frame: serFrame }, [
        channel.port2,
        serFrame.buffer.buffer,
    ]);
}
function mainReadFrames(reader) {
    reader.read().then(({ value, done }) => {
        if (done)
            return;
        console.log("read frame", value);
        mainReadFrames(reader);
    });
}
// Is there supposed to be a way to get the key names from a VideoFrame?
// In any case, this works.
async function mostlySerializableFrame(frame) {
    const props = [
        "codedHeight",
        "codedRect",
        "codedWidth",
        "colorSpace",
        "displayHeight",
        "displayWidth",
        "duration",
        "format",
        "timestamp",
        "visibleRect",
        "colorspace",
    ];
    const serializedFrame = Object.fromEntries(props.map((prop) => [prop, frame[prop]]));
    const buffer = new Uint8Array(frame.allocationSize());
    frame.copyTo(buffer);
    return { meta: serializedFrame, buffer };
}
async function handleSerializedFrameEvent(event) {
    const frame = await deserializeFrame(event.data);
    console.log("deserialized frame", frame);
}
async function deserializeFrame({ buffer, meta, }) {
    // This will work in Chrome, but not Safari.
    // https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame/VideoFrame
    let frame;
    try {
        frame = new VideoFrame(buffer, meta);
    }
    catch (err) {
        if (err.name === "TypeError")
            console.error("Expected for Safari:", err);
    }
    // This will work in Safari
    if (!frame) {
        const imageData = new ImageData(meta.codedWidth, meta.codedHeight);
        for (let i = 0; i < buffer.length; i++) {
            imageData.data[i] = buffer[i];
        }
        const bitmap = await createImageBitmap(imageData);
        frame = new VideoFrame(bitmap, meta);
    }
    return frame;
}
