const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
    server
});

const PORT = 3000;

// Users currently waiting for a stranger
const waitingUsers = new Set();

app.use(express.static("public"));


// ==========================================
// HELPERS
// ==========================================

function sanitizeName(name) {

    const clean =
        (name || "")
            .toString()
            .trim()
            .slice(0, 20);

    return clean || "Anonymous";
}

function send(socket, payload) {

    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
    }
}


// ==========================================
// FIND A RANDOM STRANGER
// ==========================================

function findStranger(socket) {

    // Get all users currently waiting
    const availableUsers =
        [...waitingUsers].filter(
            user =>
                user !== socket &&
                user.readyState === WebSocket.OPEN &&
                !user.partner
        );

    if (availableUsers.length === 0) {
        return null;
    }

    // Pick a random waiting user
    const randomIndex =
        Math.floor(
            Math.random() * availableUsers.length
        );

    return availableUsers[randomIndex];
}


// ==========================================
// START MATCHMAKING
// ==========================================

function findMatch(socket) {

    // Remove the user from the waiting queue
    waitingUsers.delete(socket);

    // If already connected to someone, don't match again
    if (socket.partner) {
        return;
    }

    const stranger =
        findStranger(socket);

    // Nobody available
    if (!stranger) {

        waitingUsers.add(socket);

        send(socket, {
            type: "waiting"
        });

        console.log(
            `${socket.id} (${socket.username}) is waiting for a stranger`
        );

        return;
    }

    // Remove stranger from waiting queue
    waitingUsers.delete(stranger);

    // Connect the two users
    socket.partner = stranger;
    stranger.partner = socket;

    console.log(
        `Matched ${socket.id} (${socket.username}) with ${stranger.id} (${stranger.username})`
    );

    // Tell both users who they're talking to, and who should
    // originate the WebRTC offer (the side that was already
    // waiting stays passive; the side that just searched calls).
    send(socket, {
        type: "matched",
        initiator: true,
        strangerName: stranger.username
    });

    send(stranger, {
        type: "matched",
        initiator: false,
        strangerName: socket.username
    });
}


// ==========================================
// END CURRENT MATCH
// ==========================================

function disconnectPartner(socket) {

    const partner = socket.partner;

    if (!partner) {
        return;
    }

    // Remove both sides of the connection
    socket.partner = null;

    if (partner.partner === socket) {
        partner.partner = null;
    }

    // Tell the other person
    send(partner, {
        type: "stranger-left"
    });

    console.log(
        `${socket.id}'s match ended`
    );
}


// ==========================================
// WEBSOCKET CONNECTION
// ==========================================

let nextUserId = 1;

wss.on("connection", socket => {

    socket.id = nextUserId++;

    socket.partner = null;

    socket.username = "Anonymous";

    console.log(
        `User ${socket.id} connected`
    );


    socket.on("message", rawData => {

        try {

            const data =
                JSON.parse(rawData);


            // ==================================
            // FIND STRANGER
            // ==================================

            if (data.type === "find") {

                socket.username =
                    sanitizeName(data.username);

                // If already matched,
                // don't create another match
                if (socket.partner) {
                    return;
                }

                findMatch(socket);

                return;
            }


            // ==================================
            // NEXT STRANGER
            // ==================================

            if (data.type === "next") {

                // End current conversation
                disconnectPartner(socket);

                // Immediately search again
                findMatch(socket);

                return;
            }


            // ==================================
            // CHAT MESSAGE
            // ==================================

            if (data.type === "message") {

                if (!socket.partner) {
                    return;
                }

                const message =
                    data.message?.trim();

                if (!message) {
                    return;
                }

                // Limit message size
                if (message.length > 1000) {
                    return;
                }

                send(socket.partner, {
                    type: "message",
                    message: message
                });

                return;
            }


            // ==================================
            // WEBRTC SIGNALING
            // (offer / answer / ice-candidate are
            // opaque to the server - just relay them
            // to whoever this socket is paired with)
            // ==================================

            if (
                data.type === "offer" ||
                data.type === "answer" ||
                data.type === "ice-candidate"
            ) {

                if (!socket.partner) {
                    return;
                }

                send(socket.partner, {
                    type: data.type,
                    payload: data.payload
                });

                return;
            }


            // ==================================
            // MEDIA STATE (mic/camera on-off,
            // purely cosmetic info for the peer's UI)
            // ==================================

            if (data.type === "media-state") {

                if (!socket.partner) {
                    return;
                }

                send(socket.partner, {
                    type: "media-state",
                    audio: !!data.audio,
                    video: !!data.video
                });

                return;
            }

        } catch (error) {

            console.error(
                "Invalid WebSocket data:",
                error
            );
        }
    });


    // ==========================================
    // USER DISCONNECTED
    // ==========================================

    socket.on("close", () => {

        console.log(
            `User ${socket.id} disconnected`
        );

        // Remove from waiting queue
        waitingUsers.delete(socket);

        // Tell partner
        disconnectPartner(socket);
    });


    socket.on("error", error => {

        console.error(
            `User ${socket.id} WebSocket error:`,
            error
        );
    });

});


// ==========================================
// START SERVER
// ==========================================

server.listen(PORT, () => {

    console.log("");
    console.log("==============================");
    console.log("     WAVELENGTH CHAT SERVER");
    console.log("==============================");
    console.log("");

    console.log(
        `Open: http://localhost:${PORT}`
    );

    console.log("");
});
