// ==========================================
// STATE
// ==========================================

let socket = null;
let pc = null;
let localStream = null;
let username = "Anonymous";
let strangerName = "Stranger";
let pendingCandidates = [];
let isInitiator = false;

const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
];


// ==========================================
// ELEMENTS
// ==========================================

const landingScreen = document.getElementById("landingScreen");
const landingForm = document.getElementById("landingForm");
const usernameInput = document.getElementById("usernameInput");
const wantVideo = document.getElementById("wantVideo");
const wantAudio = document.getElementById("wantAudio");
const startButton = document.getElementById("startButton");
const landingError = document.getElementById("landingError");

const previewVideo = document.getElementById("previewVideo");
const previewPlaceholder = document.getElementById("previewPlaceholder");
const previewInitial = document.getElementById("previewInitial");

const callScreen = document.getElementById("callScreen");
const brandDot = document.getElementById("brandDot");
const statusDisplay = document.getElementById("statusDisplay");
const strangerDisplay = document.getElementById("strangerDisplay");
const leaveButton = document.getElementById("leaveButton");

const remoteVideo = document.getElementById("remoteVideo");
const remotePlaceholder = document.getElementById("remotePlaceholder");
const remoteInitial = document.getElementById("remoteInitial");
const remoteStatusText = document.getElementById("remoteStatusText");
const remoteCameraOffBadge = document.getElementById("remoteCameraOffBadge");

const localVideo = document.getElementById("localVideo");
const localPlaceholder = document.getElementById("localPlaceholder");
const localInitial = document.getElementById("localInitial");

const messagesContainer = document.getElementById("messages");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");

const micButton = document.getElementById("micButton");
const cameraButton = document.getElementById("cameraButton");
const nextButton = document.getElementById("nextButton");


// ==========================================
// TUNING DIAL (decorative)
// ==========================================

(function buildDial() {

    const group = document.querySelector(".dialTicks");

    if (!group) {
        return;
    }

    const total = 40;
    const cx = 120;
    const cy = 120;

    for (let i = 0; i < total; i++) {

        const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
        const major = i % 5 === 0;

        const outer = 100;
        const inner = major ? 84 : 94;

        const line = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "line"
        );

        line.setAttribute("x1", cx + Math.cos(angle) * outer);
        line.setAttribute("y1", cy + Math.sin(angle) * outer);
        line.setAttribute("x2", cx + Math.cos(angle) * inner);
        line.setAttribute("y2", cy + Math.sin(angle) * inner);

        if (major) {
            line.classList.add("major");
        }

        group.appendChild(line);
    }
})();


// ==========================================
// LANDING — LIVE CAMERA PREVIEW
// ==========================================

function updatePreviewVisibility() {

    const hasVideoTrack =
        !!localStream &&
        localStream.getVideoTracks().some(t => t.enabled);

    previewPlaceholder.classList.toggle("hidden", hasVideoTrack);
}

async function requestMedia() {

    if (!wantVideo.checked && !wantAudio.checked) {
        localStream = null;
        updatePreviewVisibility();
        return;
    }

    try {

        localStream = await navigator.mediaDevices.getUserMedia({
            video: wantVideo.checked,
            audio: wantAudio.checked
        });

        previewVideo.srcObject = localStream;

        hideLandingError();

    } catch (error) {

        console.warn("Could not access camera/microphone:", error);

        localStream = null;

        showLandingError(
            "Camera or microphone unavailable — you can still chat by text."
        );
    }

    updatePreviewVisibility();
}

function showLandingError(text) {

    landingError.textContent = text;
    landingError.classList.remove("hidden");
}

function hideLandingError() {

    landingError.classList.add("hidden");
}

[wantVideo, wantAudio].forEach(box => {

    box.addEventListener("change", () => {

        if (!localStream) {

            requestMedia();

            return;
        }

        const videoTrack = localStream.getVideoTracks()[0];
        const audioTrack = localStream.getAudioTracks()[0];

        if (videoTrack) {
            videoTrack.enabled = wantVideo.checked;
        } else if (wantVideo.checked) {
            requestMedia();
            return;
        }

        if (audioTrack) {
            audioTrack.enabled = wantAudio.checked;
        } else if (wantAudio.checked) {
            requestMedia();
            return;
        }

        updatePreviewVisibility();
    });
});

requestMedia();


// ==========================================
// START CALL
// ==========================================

landingForm.addEventListener("submit", event => {

    event.preventDefault();

    username = usernameInput.value.trim().slice(0, 20) || "Anonymous";

    previewInitial.textContent = username[0].toUpperCase();
    localInitial.textContent = username[0].toUpperCase();

    startButton.disabled = true;
    startButton.textContent = "Connecting…";

    connectWebSocket();
});


// ==========================================
// WEBSOCKET
// ==========================================

function connectWebSocket() {

    const protocol =
        window.location.protocol === "https:" ? "wss:" : "ws:";

    socket = new WebSocket(`${protocol}//${window.location.host}`);

    socket.addEventListener("open", () => {

        console.log("WebSocket connected");

        landingScreen.classList.add("hidden");
        callScreen.classList.remove("hidden");

        localVideo.srcObject = localStream;

        const hasAudioTrack = !!localStream && localStream.getAudioTracks().length > 0;
        const hasVideoTrack = !!localStream && localStream.getVideoTracks().length > 0;

        setMicIcon(hasAudioTrack && localStream.getAudioTracks().some(t => t.enabled));
        setCameraIcon(hasVideoTrack && localStream.getVideoTracks().some(t => t.enabled));

        micButton.disabled = !hasAudioTrack;
        cameraButton.disabled = !hasVideoTrack;

        setStatus("Searching…", "");
        remoteStatusText.textContent = "Searching for a signal…";

        socket.send(JSON.stringify({ type: "find", username }));
    });

    socket.addEventListener("message", event => {

        let data;

        try {
            data = JSON.parse(event.data);
        } catch (error) {
            console.error("Invalid server message:", error);
            return;
        }

        handleServerMessage(data);
    });

    socket.addEventListener("close", () => {

        console.log("WebSocket disconnected");

        setStatus("Off air", "");
        teardownCall();
    });

    socket.addEventListener("error", error => {

        console.error("WebSocket error:", error);
    });
}

function handleServerMessage(data) {

    switch (data.type) {

        case "waiting":
            setStatus("Searching…", "");
            strangerDisplay.textContent = "";
            remoteInitial.textContent = "·";
            showRemotePlaceholder("Searching for a signal…");
            messageInput.disabled = true;
            nextButton.disabled = false;
            break;

        case "matched":
            onMatched(data);
            break;

        case "message":
            addMessage(strangerName, data.message, false);
            scrollToBottom();
            break;

        case "offer":
            onOffer(data.payload);
            break;

        case "answer":
            onAnswer(data.payload);
            break;

        case "ice-candidate":
            onRemoteCandidate(data.payload);
            break;

        case "media-state":
            remoteCameraOffBadge.classList.toggle("hidden", data.video !== false);
            break;

        case "stranger-left":
            onStrangerLeft();
            break;
    }
}


// ==========================================
// MATCHMAKING EVENTS
// ==========================================

function onMatched(data) {

    strangerName = data.strangerName || "Stranger";
    isInitiator = !!data.initiator;

    setStatus("On air", "live");
    strangerDisplay.textContent = `with ${strangerName}`;
    remoteInitial.textContent = strangerName[0].toUpperCase();
    remoteCameraOffBadge.classList.add("hidden");

    showRemotePlaceholder("Connecting video…");

    messagesContainer.innerHTML = "";
    addSystemMessage(`You're connected with ${strangerName}.`);

    messageInput.disabled = false;
    nextButton.disabled = false;
    messageInput.focus();

    startPeerConnection();
}

function onStrangerLeft() {

    setStatus("Stranger left", "gone");
    strangerDisplay.textContent = "";
    remoteInitial.textContent = "·";
    showRemotePlaceholder("The stranger left. Find someone new when you're ready.");

    messageInput.disabled = true;
    addSystemMessage("The stranger left the chat.");
    scrollToBottom();

    closePeerConnection();
}


// ==========================================
// WEBRTC
// ==========================================

function startPeerConnection() {

    closePeerConnection();

    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    if (localStream) {

        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });

    } else {

        pc.addTransceiver("audio", { direction: "recvonly" });
        pc.addTransceiver("video", { direction: "recvonly" });
    }

    pc.addEventListener("icecandidate", event => {

        if (event.candidate) {
            sendSignal("ice-candidate", event.candidate);
        }
    });

    pc.addEventListener("track", event => {

        remoteVideo.srcObject = event.streams[0];
        hideRemotePlaceholder();
    });

    pc.addEventListener("connectionstatechange", () => {

        if (!pc) {
            return;
        }

        if (pc.connectionState === "failed") {
            showRemotePlaceholder("Lost the signal. Try finding someone new.");
        }
    });

    if (isInitiator) {
        makeOffer();
    }
}

async function makeOffer() {

    try {

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal("offer", pc.localDescription);

    } catch (error) {

        console.error("Error creating offer:", error);
    }
}

async function onOffer(payload) {

    if (!pc) {
        startPeerConnection();
    }

    try {

        await pc.setRemoteDescription(new RTCSessionDescription(payload));
        await flushPendingCandidates();

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal("answer", pc.localDescription);

    } catch (error) {

        console.error("Error handling offer:", error);
    }
}

async function onAnswer(payload) {

    if (!pc) {
        return;
    }

    try {

        await pc.setRemoteDescription(new RTCSessionDescription(payload));
        await flushPendingCandidates();

    } catch (error) {

        console.error("Error handling answer:", error);
    }
}

async function onRemoteCandidate(payload) {

    if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {

        pendingCandidates.push(payload);

        return;
    }

    try {

        await pc.addIceCandidate(new RTCIceCandidate(payload));

    } catch (error) {

        console.error("Error adding ICE candidate:", error);
    }
}

async function flushPendingCandidates() {

    while (pendingCandidates.length) {

        const candidate = pendingCandidates.shift();

        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
            console.error("Error adding queued ICE candidate:", error);
        }
    }
}

function sendSignal(type, payload) {

    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type, payload }));
    }
}

function sendMediaState(audio, video) {

    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "media-state", audio, video }));
    }
}

function closePeerConnection() {

    if (pc) {
        pc.close();
        pc = null;
    }

    pendingCandidates = [];

    remoteVideo.srcObject = null;
}

function teardownCall() {

    closePeerConnection();

    messageInput.disabled = true;
    nextButton.disabled = true;
}


// ==========================================
// CHAT
// ==========================================

messageForm.addEventListener("submit", event => {

    event.preventDefault();

    const message = messageInput.value.trim();

    if (!message || !socket || socket.readyState !== WebSocket.OPEN) {
        return;
    }

    if (messageInput.disabled) {
        return;
    }

    socket.send(JSON.stringify({ type: "message", message }));

    addMessage(username, message, true);

    messageInput.value = "";
    messageInput.focus();

    scrollToBottom();
});

function addMessage(name, text, own) {

    const wrapper = document.createElement("div");
    wrapper.classList.add("message");

    if (own) {
        wrapper.classList.add("own");
    }

    const nameEl = document.createElement("div");
    nameEl.classList.add("username");
    nameEl.textContent = name;

    const textEl = document.createElement("div");
    textEl.classList.add("text");
    textEl.textContent = text;

    wrapper.appendChild(nameEl);
    wrapper.appendChild(textEl);

    messagesContainer.appendChild(wrapper);
}

function addSystemMessage(text) {

    const el = document.createElement("div");
    el.classList.add("systemMessage");
    el.textContent = text;

    messagesContainer.appendChild(el);
}

function scrollToBottom() {

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}


// ==========================================
// NEXT / LEAVE
// ==========================================

nextButton.addEventListener("click", () => {

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
    }

    messagesContainer.innerHTML = "";
    setStatus("Searching…", "");
    strangerDisplay.textContent = "";
    remoteInitial.textContent = "·";
    showRemotePlaceholder("Searching for a signal…");

    messageInput.value = "";
    messageInput.disabled = true;

    closePeerConnection();

    socket.send(JSON.stringify({ type: "next" }));
});

leaveButton.addEventListener("click", () => {

    closePeerConnection();

    if (socket) {
        socket.close();
        socket = null;
    }

    messagesContainer.innerHTML = "";
    messageInput.disabled = true;
    nextButton.disabled = true;

    callScreen.classList.add("hidden");
    landingScreen.classList.remove("hidden");

    startButton.disabled = false;
    startButton.textContent = "Go on air";

    previewVideo.srcObject = localStream;
    updatePreviewVisibility();

    usernameInput.focus();
});


// ==========================================
// STATUS / PLACEHOLDER HELPERS
// ==========================================

function setStatus(text, mode) {

    statusDisplay.textContent = text;
    statusDisplay.classList.remove("live", "gone");
    brandDot.classList.remove("live");

    if (mode === "live") {
        statusDisplay.classList.add("live");
        brandDot.classList.add("live");
    } else if (mode === "gone") {
        statusDisplay.classList.add("gone");
    }
}

function showRemotePlaceholder(text) {

    remoteStatusText.textContent = text;
    remotePlaceholder.classList.remove("hidden");
}

function hideRemotePlaceholder() {

    remotePlaceholder.classList.add("hidden");
}


// ==========================================
// MIC / CAMERA CONTROLS
// ==========================================

function setMicIcon(on) {

    micButton.querySelector(".iconOn").classList.toggle("hidden", !on);
    micButton.querySelector(".iconOff").classList.toggle("hidden", on);
    micButton.classList.toggle("off", !on);
    micButton.setAttribute("aria-pressed", String(on));
}

function setCameraIcon(on) {

    cameraButton.querySelector(".iconOn").classList.toggle("hidden", !on);
    cameraButton.querySelector(".iconOff").classList.toggle("hidden", on);
    cameraButton.classList.toggle("off", !on);
    cameraButton.setAttribute("aria-pressed", String(on));
    localPlaceholder.classList.toggle("hidden", on);
}

micButton.addEventListener("click", () => {

    if (!localStream) {
        return;
    }

    const track = localStream.getAudioTracks()[0];

    if (!track) {
        return;
    }

    track.enabled = !track.enabled;
    setMicIcon(track.enabled);

    sendMediaState(
        track.enabled,
        localStream.getVideoTracks().some(t => t.enabled)
    );
});

cameraButton.addEventListener("click", () => {

    if (!localStream) {
        return;
    }

    const track = localStream.getVideoTracks()[0];

    if (!track) {
        return;
    }

    track.enabled = !track.enabled;
    setCameraIcon(track.enabled);

    sendMediaState(
        localStream.getAudioTracks().some(t => t.enabled),
        track.enabled
    );
});
