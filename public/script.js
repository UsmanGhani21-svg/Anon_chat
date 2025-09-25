// Global state
let currentUser = null;
let currentRoom = null;
let socket = null;
let rooms = [];
let sidebarOpen = false;

// Initialize the application
document.addEventListener('DOMContentLoaded', function () {
    // Check if user profile exists in session
    const savedUser = sessionStorage.getItem('anonChatUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showChatInterface();
        connectWebSocket();
    }

    // Auto-join room from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    if (roomId && currentUser) {
        setTimeout(() => joinRoom(roomId), 1000);
    }
});

// Mobile sidebar controls
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');

    sidebarOpen = !sidebarOpen;

    if (sidebarOpen) {
        sidebar.classList.add('open');
        overlay.classList.add('open');
    } else {
        sidebar.classList.remove('open');
        overlay.classList.remove('open');
    }
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');

    sidebarOpen = false;
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
}

// Profile creation
function createProfile() {
    const username = document.getElementById('username').value.trim();
    const avatar = document.getElementById('avatar').value;

    if (!username) {
        showNotification('Please enter a username', 'error');
        return;
    }

    if (username.length < 2) {
        showNotification('Username must be at least 2 characters long', 'error');
        return;
    }

    if (username.length > 20) {
        showNotification('Username must be less than 20 characters', 'error');
        return;
    }

    currentUser = {
        id: generateUserId(),
        username: username,
        avatar: avatar,
        joinedAt: new Date().toISOString()
    };

    // Store user in session storage (cleared on browser close)
    sessionStorage.setItem('anonChatUser', JSON.stringify(currentUser));

    showChatInterface();
    connectWebSocket();
}

function showChatInterface() {
    document.getElementById('profile-screen').classList.add('hidden');
    document.getElementById('chat-interface').classList.remove('hidden');

    // Update user profile in sidebar
    document.getElementById('user-name').textContent = currentUser.username;
    document.getElementById('user-avatar-text').textContent = currentUser.username.charAt(0).toUpperCase();
    document.getElementById('user-avatar').style.background = currentUser.avatar;
}

// WebSocket connection with real Socket.IO

function connectWebSocket() {
    socket = io();

    socket.on('connect', () => {
        console.log('Connected to server');
        showNotification('Connected to AnonChat', 'success');

        // Authenticate user
        if (currentUser) {
            socket.emit('authenticate', currentUser);
        }
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        showNotification('Disconnected from server', 'error');
    });

    socket.on('authenticated', (data) => {
        if (data.success) {
            console.log('User authenticated successfully');
            loadRooms();
        }
    });

    socket.on('rooms-list', (roomList) => {
        rooms = roomList;
        updateRoomList();
    });

    socket.on('room-joined', (data) => {
        currentRoom = {
            id: data.room.id,
            name: data.room.name,
            participants: data.room.participants,
            messages: data.messages || []
        };
        socket.on("new-admin", (data) => {
            if (currentUser.id === data.newAdmin) {
                showNotification("You are now the room admin", "info");
            }
            loadRooms(); // refresh list so button appears
        });

        // Update UI
        document.getElementById('welcome-screen').classList.add('hidden');
        document.getElementById('chat-room').classList.remove('hidden');
        document.getElementById('room-title').textContent = currentRoom.name;
        document.getElementById('participant-count').textContent = `${currentRoom.participants} online`;

        loadMessages();
        updateRoomList();
        closeSidebar();
        showNotification(`Joined "${currentRoom.name}"`, 'success');
    });





    socket.on('newMessage', (message) => {
        console.log("Received newMessage:", message);
        if (currentRoom) {
            currentRoom.messages.push(message);
            loadMessages();
        }
    });



    socket.on('user-joined', (data) => {
        if (currentRoom) {
            currentRoom.participants = data.participants;
            document.getElementById('participant-count').textContent = `${data.participants} online`;
            showNotification(`${data.username} joined the room`, 'info');
        }
    });

    socket.on('user-left', (data) => {
        if (currentRoom) {
            currentRoom.participants = data.participants;
            document.getElementById('participant-count').textContent = `${data.participants} online`;
            showNotification(`${data.username} left the room`, 'info');
        }
    });



    socket.on('chatCleared', () => {
        if (currentRoom) {
            currentRoom.messages = [];
            loadMessages();
            showNotification(`Chat cleared`, 'info');
        }
    });

    socket.on("new-admin", (data) => {
        if (currentUser.id === data.newAdmin) {
            showNotification("You are now the room admin", "info");
        }
        loadRooms();
    });


    socket.on('room-deleted', (data) => {
        showNotification(data.message, 'error');

        // Return to welcome screen
        document.getElementById('chat-room').classList.add('hidden');
        document.getElementById('welcome-screen').classList.remove('hidden');
        currentRoom = null;
        loadRooms();
    });

    socket.on('user-typing', (data) => {
        // Handle typing indicators if needed
        console.log(`${data.username} is typing...`);
    });

    socket.on('error', (data) => {
        showNotification(data.message, 'error');
    });
}

function loadRooms() {
    if (socket) {
        socket.emit('get-rooms');
    }
}



function updateRoomList() {
    const roomList = document.getElementById('room-list');
    const roomCount = document.getElementById('room-count');

    roomCount.textContent = rooms.length;

    if (rooms.length === 0) {
        roomList.innerHTML = `
                    <div style="text-align: center; color: var(--text-muted); padding: 2rem 1rem;">
                        <p style="margin-bottom: 0.5rem;">No active rooms</p>
                        <small>Create or join a room to start chatting</small>
                    </div>
                `;
        return;
    }

    // roomList.innerHTML = rooms.map(room => `
    //     <div class="room-item ${currentRoom && currentRoom.id === room.id ? 'active' : ''}" onclick="joinRoom('${room.id}')">
    //         <div class="room-name">${escapeHtml(room.name)}</div>
    //         <div class="room-meta">
    //             <span>${room.participants || 1} participants</span>
    //             <span>${formatRelativeTime(room.createdAt)}</span>
    //         </div>
    //     </div>
    // `).join('');
    roomList.innerHTML = rooms.map(room => `
    <div class="room-item ${currentRoom && currentRoom.id === room.id ? 'active' : ''}">
        <div onclick="joinRoom('${room.id}')">
            <div class="room-name">${escapeHtml(room.name)}</div>
            <div class="room-meta">
                <span>${room.participants || 1} participants</span>
                <span>${formatRelativeTime(room.createdAt)}</span>
            </div>
        </div>
        ${room.creator === currentUser.id ? `
            <button class="btn btn-danger btn-sm" onclick="deleteRoom('${room.id}')">🗑️</button>
        ` : ""}
    </div>
`).join('');
}

function createRoom() {
    const roomName = prompt('Enter room name:');
    if (!roomName || !roomName.trim()) return;

    if (roomName.length > 50) {
        showNotification('Room name must be less than 50 characters', 'error');
        return;
    }

    // Create room via API
    fetch('/api/rooms', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: roomName.trim(),
            userId: currentUser.id
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                showNotification(data.error, 'error');
            } else {
                joinRoom(data.id);
                showNotification(`Room "${roomName}" created!`, 'success');
            }
        })
        .catch(error => {
            console.error('Error creating room:', error);
            showNotification('Failed to create room', 'error');
        });
}

function joinRoomPrompt() {
    const roomId = prompt('Enter room ID or paste room link:');
    if (!roomId) return;

    const extractedId = roomId.includes('?room=') ?
        roomId.split('?room=')[1].split('&')[0] :
        roomId.split('/').pop();
    joinRoom(extractedId);
}

function joinRoom(roomId) {
    if (!socket || !currentUser) {
        showNotification('Not connected to server', 'error');
        return;
    }

    socket.emit('join-room', {
        roomId: roomId,
        userId: currentUser.id
    });
}

// function loadMessages() {
//     if (!currentRoom) return;

//     const messagesContainer = document.getElementById("chat-messages");
//     messagesContainer.innerHTML = "";

//     currentRoom.messages.forEach((message) => {
//         const username = message.username || "Anonymous";
//         const avatar = message.avatar || "#6366f1";
//         const content = message.content || "";
//         const timestamp = message.timestamp ? formatTime(message.timestamp) : "now";

//         const div = document.createElement("div");
//         div.classList.add("message");
//         div.innerHTML = `
//     <div class="message-header">
//         <span class="avatar" style="background:${avatar}">${username.charAt(0).toUpperCase()}</span>
//         <span class="user">${username}</span>
//         <span class="time">${timestamp}</span>
//     </div>
//     <div class="message-content">
//         ${content}
//     </div>
// `;
//         messagesContainer.appendChild(div);
//     });

//     messagesContainer.scrollTop = messagesContainer.scrollHeight;
// }
function loadMessages() {
    if (!currentRoom) return;

    const messagesContainer = document.getElementById("chat-messages");
    messagesContainer.innerHTML = "";

    currentRoom.messages.forEach((message) => {
        const username = message.username || "Anonymous";
        const avatar = message.avatar || "#6366f1";
        const timestamp = message.timestamp ? formatTime(message.timestamp) : "now";

        const div = document.createElement("div");
        div.classList.add("message");

        if (message.type === "file") {
            // ✅ Render file message
            const sizeMB = (message.fileSize / (1024 * 1024)).toFixed(2);
            div.innerHTML = `
                <div class="message-header">
                    <span class="avatar" style="background:${avatar}">${username.charAt(0).toUpperCase()}</span>
                    <span class="user">${username}</span>
                    <span class="time">${timestamp}</span>
                </div>
                <div class="message-content">
                    📎 <a href="${message.fileUrl}" target="_blank">${message.fileName}</a>
                    <small>(${sizeMB} MB)</small>
                </div>
            `;
        } else {
            // ✅ Normal text message
            const content = message.content || "";
            div.innerHTML = `
                <div class="message-header">
                    <span class="avatar" style="background:${avatar}">${username.charAt(0).toUpperCase()}</span>
                    <span class="user">${username}</span>
                    <span class="time">${timestamp}</span>
                </div>
                <div class="message-content">
                    ${content}
                </div>
            `;
        }

        messagesContainer.appendChild(div);
    });

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}


function sendMessage(event) {
    const input = document.getElementById('message-input');
    const content = input.value.trim();

    if (!content || !currentRoom || !socket) return;

    if (content.length > 500) {
        showNotification('Message is too long (max 500 characters)', 'error');
        return;
    }

    // Send message via Socket.IO (camelCase event)
    socket.emit('sendMessage', {
        content: content,
        roomId: currentRoom.id
    });

    input.value = '';

    // Add send animation
    const sendBtn = event?.target || document.querySelector('[onclick="sendMessage()"]');
    if (sendBtn) {
        sendBtn.style.transform = 'scale(0.95)';
        setTimeout(() => {
            sendBtn.style.transform = '';
        }, 150);
    }
}


function handleMessageKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function shareRoom() {
    if (!currentRoom) return;

    const shareContainer = document.getElementById('share-link-container');
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${currentRoom.id}`;

    document.getElementById('share-url').textContent = shareUrl;
    shareContainer.classList.toggle('hidden');
}

function copyShareLink() {
    const shareUrl = document.getElementById('share-url').textContent;

    if (navigator.clipboard) {
        navigator.clipboard.writeText(shareUrl).then(() => {
            showNotification('Link copied to clipboard!', 'success');
        }).catch(() => {
            fallbackCopyText(shareUrl);
        });
    } else {
        fallbackCopyText(shareUrl);
    }
}

function fallbackCopyText(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
        document.execCommand('copy');
        showNotification('Link copied to clipboard!', 'success');
    } catch (err) {
        showNotification('Unable to copy link', 'error');
    }

    document.body.removeChild(textArea);
}


function clearChat() {
    if (!currentRoom || !socket) return;

    if (!confirm('Are you sure you want to clear all messages in this room? This action cannot be undone.')) return;

    socket.emit('clearChat', currentRoom.id); // ✅ matches server.js
}
function deleteRoom(roomId) {
    if (confirm("Are you sure you want to delete this room?")) {
        socket.emit('deleteRoom', roomId);
    }
}

function leaveRoom() {
    if (!currentRoom || !socket) return;
    socket.emit("leave-room", { roomId: currentRoom.id, userId: currentUser.id });

    document.getElementById("chat-room").classList.add("hidden");
    document.getElementById("welcome-screen").classList.remove("hidden");
    currentRoom = null;
}

function logout() {
    if (!confirm('Are you sure you want to logout? All rooms you created will be deleted.')) return;

    // Notify server about logout
    if (socket) {
        socket.emit('logout');
        socket.disconnect();
    }

    // Clear session storage
    sessionStorage.removeItem('anonChatUser');

    // Reset state
    currentUser = null;
    currentRoom = null;
    rooms = [];
    sidebarOpen = false;
    socket = null;

    // Reset UI
    document.getElementById('chat-interface').classList.add('hidden');
    document.getElementById('profile-screen').classList.remove('hidden');
    document.getElementById('chat-room').classList.add('hidden');
    document.getElementById('welcome-screen').classList.remove('hidden');
    document.getElementById('sidebar').classList.remove('open');
    document.querySelector('.sidebar-overlay').classList.remove('open');

    // Reset form
    document.getElementById('username').value = '';
    document.getElementById('avatar').value = '#6366f1';

    showNotification('Logged out successfully', 'success');
}

// Utility functions
function generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function generateRoomId() {
    return Math.random().toString(36).substr(2, 8).toUpperCase();
}

function generateMessageId() {
    return 'msg_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatRelativeTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
}
function leaveRoom() {
    if (!currentRoom || !socket) return;
    socket.emit("leave-room", { roomId: currentRoom.id, userId: currentUser.id });

    // Reset UI
    document.getElementById("chat-room").classList.add("hidden");
    document.getElementById("welcome-screen").classList.remove("hidden");
    currentRoom = null;
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 1rem 1.5rem;
                background: ${type === 'success' ? 'linear-gradient(135deg, #10b981, #059669)' :
            type === 'error' ? 'linear-gradient(135deg, #ef4444, #dc2626)' :
                'linear-gradient(135deg, #6366f1, #8b5cf6)'};
                color: white;
                border-radius: 12px;
                font-weight: 600;
                font-size: 0.9rem;
                box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
                z-index: 1000;
                transform: translateX(100%);
                transition: transform 0.3s ease;
                max-width: 300px;
                word-wrap: break-word;
            `;
    notification.textContent = message;

    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);

    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Auto-clear on window close
window.addEventListener('beforeunload', function () {
    if (currentUser && socket) {
        socket.emit('logout');
        console.log('User leaving, clearing ephemeral data');
    }
});

// Handle window resize
window.addEventListener('resize', function () {
    if (window.innerWidth > 768 && sidebarOpen) {
        closeSidebar();
    }
});

// Add typing indicators
let typingTimer;
let isTyping = false;

document.getElementById('message-input')?.addEventListener('input', function () {
    this.style.borderColor = 'var(--accent-primary)';

    if (socket && currentRoom && !isTyping) {
        socket.emit('typing', { roomId: currentRoom.id, isTyping: true });
        isTyping = true;
    }

    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        this.style.borderColor = '';
        if (socket && currentRoom && isTyping) {
            socket.emit('typing', { roomId: currentRoom.id, isTyping: false });
            isTyping = false;
        }
    }, 1000);
});