// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json());

app.post('/api/rooms', (req, res) => {
    const { name, userId } = req.body;
    if (!name || !userId) {
        return res.status(400).json({ error: 'Missing room name or userId' });
    }

    const roomId = generateRoomId();
    const room = {
        id: roomId,
        name,
        creator: userId,
        users: new Set([userId]),
        messages: [],
        createdAt: Date.now()
    };

    rooms.set(roomId, room);

    // Broadcast updated list
    broadcastRoomsList();

    res.json({ id: roomId });
});

// Storage for uploaded files
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 200 * 1024 * 1024 } // ✅ 200MB
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileUrl = `/uploads/${req.file.filename}-${req.file.originalname}`;
    const filePath = path.join(uploadDir, `${req.file.filename}-${req.file.originalname}`);
    fs.renameSync(req.file.path, filePath);

    res.json({ url: fileUrl, name: req.file.originalname, size: req.file.size });
});

// Serve uploaded files
app.use('/uploads', express.static(uploadDir));
// In-memory storage (use Redis or database in production)
const users = new Map();
const rooms = new Map();
const userSessions = new Map();

// Utility functions
function generateRoomId() {
    return Math.random().toString(36).substr(2, 9);
}

function cleanupUserData(userId) {
    // Remove user's messages from all rooms
    rooms.forEach(room => {
        room.messages = room.messages.filter(msg => msg.userId !== userId);
    });

    // Remove user from rooms
    rooms.forEach(room => {
        room.users.delete(userId);
    });

    // Clean up empty rooms
    const emptyRooms = [];
    rooms.forEach((room, roomId) => {
        if (room.users.size === 0) {
            emptyRooms.push(roomId);
        }
    });

    emptyRooms.forEach(roomId => {
        rooms.delete(roomId);
    });
}
function uploadFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 200 * 1024 * 1024) {
        showNotification("File too large (max 200MB)", "error");
        return;
    }

    const formData = new FormData();
    formData.append("file", file);

    fetch("/api/upload", {
        method: "POST",
        body: formData
    })
        .then(res => res.json())
        .then(data => {
            socket.emit("sendFile", {
                roomId: currentRoom.id,
                fileUrl: data.url,
                fileName: data.name,
                fileSize: data.size
            });
        })
        .catch(() => {
            showNotification("File upload failed", "error");
        });
}

function getRoomsList() {
    const roomsList = [];
    rooms.forEach((room, roomId) => {
        roomsList.push({
            id: roomId,
            name: room.name,
            creator: room.creator,
            participants: room.users.size,
            createdAt: room.createdAt
        });
    });
    return roomsList.sort((a, b) => b.createdAt - a.createdAt);
}

// function broadcastRoomsList() {
//     const roomsList = getRoomsList();
//     io.emit('roomsList', roomsList);
// }
function broadcastRoomsList() {
    const roomsList = getRoomsList();
    io.emit('rooms-list', roomsList);  // 🔹 hyphenated
}


// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 🔹 Authenticate user
    // socket.on('authenticate', (user) => {
    //     socket.userId = user.id;
    //     socket.username = user.username;
    //     socket.avatar = user.avatar;
    //     console.log(`User authenticated: ${user.username}`);
    //     socket.emit('authenticated', { success: true });
    // });
    socket.on('authenticate', (user) => {
        socket.userId = user.id;
        socket.username = user.username;
        socket.avatar = user.avatar;

        // ✅ Ensure user is tracked for clearChat/deleteRoom
        users.set(user.id, user);
        userSessions.set(socket.id, user.id);

        console.log(`User authenticated: ${user.username}`);
        socket.emit('authenticated', { success: true });
    });


    // User registration
    socket.on('register', (userData) => {
        const user = {
            id: userData.id,
            username: userData.username,
            avatar: userData.avatar,
            socketId: socket.id,
            joinedAt: new Date()
        };

        users.set(userData.id, user);
        userSessions.set(socket.id, userData.id);

        // Send current rooms list
        socket.emit('roomsList', getRoomsList());

        console.log(`User registered: ${userData.username} (${userData.id})`);
    });

    // Create room
    socket.on('createRoom', (roomData) => {
        const userId = userSessions.get(socket.id);
        const user = users.get(userId);

        if (!user) return;

        const roomId = generateRoomId();
        const room = {
            id: roomId,
            name: roomData.name,
            creator: userId,
            users: new Set([userId]),
            messages: [],
            createdAt: new Date()
        };

        rooms.set(roomId, room);

        // Join the room
        socket.join(roomId);

        // Emit room created event
        socket.emit('roomCreated', { id: roomId, name: room.name });

        // Broadcast updated rooms list
        broadcastRoomsList();

        console.log(`Room created: ${roomData.name} by ${user.username}`);
    });
    socket.on('leave-room', ({ roomId, userId }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        room.users.delete(userId);
        socket.leave(roomId);

        if (room.creator === userId) {
            const nextUser = [...room.users][0];
            if (nextUser) {
                room.creator = nextUser;
                io.to(roomId).emit("new-admin", { roomId, newAdmin: nextUser });
            } else {
                rooms.delete(roomId);
                io.emit("room-deleted", { roomId, message: `Room "${room.name}" deleted (no users left)` });
                broadcastRoomsList();
                return;
            }
        }

        io.to(roomId).emit("user-left", { username: socket.username, participants: room.users.size });
        broadcastRoomsList();
    });

    // 
    // Join room
    socket.on('join-room', ({ roomId, userId }) => {
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }

        // Leave any previous rooms
        socket.rooms.forEach(r => {
            if (r !== socket.id) {
                socket.leave(r);
            }
        });
        //     socket.on('leave-room', ({ roomId, userId }) => {
        //     const room = rooms.get(roomId);
        //     if (!room) return;

        //     room.users.delete(userId);
        //     socket.leave(roomId);

        //     // If creator leaves → pick new admin
        //     if (room.creator === userId) {
        //         const nextUser = [...room.users][0];
        //         if (nextUser) {
        //             room.creator = nextUser;
        //             io.to(roomId).emit("new-admin", { roomId, newAdmin: nextUser });
        //         } else {
        //             // If empty → delete room
        //             rooms.delete(roomId);
        //             io.emit("room-deleted", { roomId, message: `Room "${room.name}" deleted (no users left)` });
        //             broadcastRoomsList();
        //             return;
        //         }
        //     }

        //     io.to(roomId).emit("user-left", { username: socket.username, participants: room.users.size });
        //     broadcastRoomsList();
        // });


        // Join new room
        socket.join(roomId);
        room.users.add(userId);

        // Send joined confirmation (frontend listens for this)
        socket.emit('room-joined', {
            room: {
                id: roomId,
                name: room.name,
                participants: room.users.size
            },
            messages: room.messages
        });

        // Notify other users already in the room
        socket.to(roomId).emit('user-joined', {
            username: userId,
            participants: room.users.size
        });

        // Update all clients with the new room list
        broadcastRoomsList();
    });
    // Send message
    socket.on('sendMessage', (messageData) => {
        const room = rooms.get(messageData.roomId);

        if (!room) {
            console.log("sendMessage failed: room not found", messageData.roomId);
            return;
        }

        const message = {
            id: Math.random().toString(36).substr(2, 9),
            userId: socket.userId,       // ✅ use authenticate info
            username: socket.username,
            avatar: socket.avatar,
            content: messageData.content,
            timestamp: new Date(),
            roomId: messageData.roomId
        };

        // Store in memory
        room.messages.push(message);

        // Broadcast to everyone in the room
        io.to(messageData.roomId).emit('newMessage', message);

        console.log(`Emitted newMessage in ${room.name}:`, message);
    });

    socket.on('sendFile', (data) => {
        const room = rooms.get(data.roomId);
        if (!room) return;

        const message = {
            id: Math.random().toString(36).substr(2, 9),
            userId: socket.userId,
            username: socket.username,
            avatar: socket.avatar,
            type: "file",
            fileUrl: data.fileUrl,
            fileName: data.fileName,
            fileSize: data.fileSize,
            timestamp: new Date(),
            roomId: data.roomId
        };

        room.messages.push(message);
        io.to(data.roomId).emit('newMessage', message);
    });

    //     // Send message
    //    socket.on('sendMessage', (messageData) => {
    //     console.log("sendMessage triggered:", {
    //     socketId: socket.id,
    //     userId,
    //     hasUser: !!user,
    //     hasRoom: !!room,
    //     isInRoom: room ? room.users.has(userId) : false
    // });
    //     const userId = userSessions.get(socket.id);
    //     const user = users.get(userId);
    //     const room = rooms.get(messageData.roomId);

    //     // if (!user || !room || !room.users.has(userId)) return;

    //     // const message = {
    //     //     id: Math.random().toString(36).substr(2, 9),
    //     //     userId: userId,
    //     //     username: user.username,
    //     //     avatar: user.avatar,
    //     //     content: messageData.content,
    //     //     timestamp: new Date(),
    //     //     roomId: messageData.roomId
    //     // };

    //     const message = {
    //         id: Math.random().toString(36).substr(2, 9),
    //         userId: socket.userId,
    //         username: socket.username,
    //         avatar: socket.avatar,
    //         content: messageData.content,
    //         timestamp: new Date(),
    //         roomId: messageData.roomId
    //     };

    //     // Store message
    //     room.messages.push(message);

    //     // Broadcast to room (new event name)
    //     // io.to(messageData.roomId).emit('newMessage', message);

    //     // console.log(`Message sent in ${room.name}: ${user.username}: ${messageData.content}`);
    //     io.to(messageData.roomId).emit('newMessage', message);

    // console.log("Emitted newMessage:", message);

    // });


    // Clear chat
    socket.on('clearChat', (roomId) => {
        const userId = userSessions.get(socket.id);
        const user = users.get(userId);
        const room = rooms.get(roomId);

        if (!user || !room || !room.users.has(userId)) return;

        // Clear all messages in the room
        room.messages = [];

        // Broadcast to room
        io.to(roomId).emit('chatCleared');

        console.log(`Chat cleared in ${room.name} by ${user.username}`);
    });
    socket.on('deleteRoom', (roomId) => {
        const room = rooms.get(roomId);
        if (!room) return;

        // Only creator can delete
        if (room.creator !== socket.userId) {
            socket.emit('error', { message: "Only room creator can delete this room" });
            return;
        }

        rooms.delete(roomId);
        io.emit('room-deleted', { roomId, message: `Room "${room.name}" deleted` });
        broadcastRoomsList();
    });

    // Logout
    socket.on('logout', () => {
        const userId = userSessions.get(socket.id);
        const user = users.get(userId);

        if (user) {
            // Notify rooms about user leaving
            rooms.forEach((room, roomId) => {
                if (room.users.has(userId)) {
                    socket.to(roomId).emit('userLeft', {
                        username: user.username,
                        userId: userId
                    });
                }
            });

            // Clean up user data
            cleanupUserData(userId);
            users.delete(userId);
            userSessions.delete(socket.id);

            // Update rooms list
            broadcastRoomsList();

            console.log(`User logged out: ${user.username}`);
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        const userId = userSessions.get(socket.id);
        const user = users.get(userId);

        if (user) {
            // Notify rooms about user leaving
            rooms.forEach((room, roomId) => {
                if (room.users.has(userId)) {
                    socket.to(roomId).emit('userLeft', {
                        username: user.username,
                        userId: userId
                    });
                }
            });

            // Clean up user data after disconnect
            setTimeout(() => {
                if (users.has(userId) && users.get(userId).socketId === socket.id) {
                    cleanupUserData(userId);
                    users.delete(userId);
                    userSessions.delete(socket.id);
                    broadcastRoomsList();
                }
            }, 5000); // 5 second grace period for reconnection

            console.log(`User disconnected: ${user.username}`);
        }

        console.log('Socket disconnected:', socket.id);
    });
});

// API Routes
app.get('/api/rooms', (req, res) => {
    res.json(getRoomsList());
});

app.get('/api/room/:roomId', (req, res) => {
    const room = rooms.get(req.params.roomId);
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }

    res.json({
        id: room.id,
        name: room.name,
        participants: room.users.size,
        createdAt: room.createdAt
    });
});

// Serve main page for any route (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Cleanup function to remove old empty rooms
setInterval(() => {
    const now = new Date();
    const emptyRooms = [];

    rooms.forEach((room, roomId) => {
        // Remove rooms that have been empty for more than 1 hour
        if (room.users.size === 0 && (now - room.createdAt) > 3600000) {
            emptyRooms.push(roomId);
        }
    });

    emptyRooms.forEach(roomId => {
        rooms.delete(roomId);
        console.log(`Cleaned up empty room: ${roomId}`);
    });

    if (emptyRooms.length > 0) {
        broadcastRoomsList();
    }
}, 300000); // Run every 5 minutes

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to access the chat`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});