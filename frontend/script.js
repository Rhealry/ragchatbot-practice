// API base URL - use relative path to work from any host
const API_URL = '/api';

// localStorage key for saved chats
const STORAGE_KEY = 'courseChats';

const WELCOME_MESSAGE = 'Welcome to the Course Materials Assistant! I can help you with questions about courses, lessons and specific content. What would you like to know?';

// Global state
// Each chat: { id, sessionId, title, messages: [{ content, type, sources }], pending }
let chats = [];
let activeChatId = null;

// DOM elements
let chatMessages, chatInput, sendButton, totalCourses, courseTitles, newChatButton, chatList;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Get DOM elements after page loads
    chatMessages = document.getElementById('chatMessages');
    chatInput = document.getElementById('chatInput');
    sendButton = document.getElementById('sendButton');
    totalCourses = document.getElementById('totalCourses');
    courseTitles = document.getElementById('courseTitles');
    newChatButton = document.getElementById('newChatButton');
    chatList = document.getElementById('chatList');

    setupEventListeners();
    loadChats();
    if (getActiveChat()) {
        renderActiveChat();
        renderChatList();
    } else {
        createNewSession();
    }
    loadCourseStats();
});

// Event Listeners
function setupEventListeners() {
    // Chat functionality
    sendButton.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // New chat
    newChatButton.addEventListener('click', () => {
        createNewSession();
        chatInput.focus();
    });

    // Suggested questions
    document.querySelectorAll('.suggested-item').forEach(button => {
        button.addEventListener('click', (e) => {
            const question = e.target.getAttribute('data-question');
            chatInput.value = question;
            sendMessage();
        });
    });
}


// Chat Functions
async function sendMessage() {
    const query = chatInput.value.trim();
    const chat = getActiveChat();
    if (!query || !chat || chat.pending) return;

    chatInput.value = '';

    // Record the question in the chat it was asked in. All later updates go to
    // this chat object, even if the user switches to another chat meanwhile.
    if (chat.messages.length === 0) {
        chat.title = query.length > 40 ? `${query.slice(0, 40)}…` : query;
    }
    chat.messages.push({ content: query, type: 'user', sources: null });
    chat.pending = true;
    saveChats();
    renderActiveChat();
    renderChatList();

    try {
        const response = await fetch(`${API_URL}/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: query,
                session_id: chat.sessionId
            })
        });

        if (!response.ok) throw new Error('Query failed');

        const data = await response.json();

        // Update session ID if new
        if (!chat.sessionId) {
            chat.sessionId = data.session_id;
        }

        chat.messages.push({ content: data.answer, type: 'assistant', sources: data.sources });

    } catch (error) {
        chat.messages.push({ content: `Error: ${error.message}`, type: 'assistant', sources: null });
    } finally {
        chat.pending = false;
        saveChats();
        renderChatList();
        // Only redraw the chat area if this chat is still the one on screen
        if (chat.id === activeChatId) {
            renderActiveChat();
            chatInput.focus();
        }
    }
}

function createLoadingMessage() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    messageDiv.innerHTML = `
        <div class="message-content">
            <div class="loading">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;
    return messageDiv;
}

function addMessage(content, type, sources = null, isWelcome = false) {
    const messageId = Date.now();
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}${isWelcome ? ' welcome-message' : ''}`;
    messageDiv.id = `message-${messageId}`;
    
    // Convert markdown to HTML for assistant messages
    const displayContent = type === 'assistant' ? marked.parse(content) : escapeHtml(content);
    
    let html = `<div class="message-content">${displayContent}</div>`;
    
    if (sources && sources.length > 0) {
        html += `
            <details class="sources-collapsible">
                <summary class="sources-header">Sources</summary>
                <div class="sources-content">${sources.map(renderSource).join(', ')}</div>
            </details>
        `;
    }
    
    messageDiv.innerHTML = html;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    return messageId;
}

// Render one source as a link when it has a URL.
// Older saved chats store sources as plain strings, so accept those too.
function renderSource(source) {
    if (typeof source === 'string') return escapeHtml(source);
    const text = escapeHtml(source.text);
    if (!source.url) return text;
    return `<a class="source-link" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
}

// Helper function to escape HTML for user messages
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Removed removeMessage function - no longer needed since we handle loading differently

// Chat Management

function getActiveChat() {
    return chats.find(chat => chat.id === activeChatId) || null;
}

function loadChats() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (saved && Array.isArray(saved.chats)) {
            // Requests in flight were lost on reload, so nothing is pending now
            chats = saved.chats.map(chat => ({ ...chat, pending: false }));
            activeChatId = saved.activeChatId;
        }
    } catch (error) {
        console.error('Error loading saved chats:', error);
        chats = [];
        activeChatId = null;
    }
}

function saveChats() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ chats, activeChatId }));
    } catch (error) {
        console.error('Error saving chats:', error);
    }
}

function createNewSession() {
    // Reuse the current chat if it's still empty, so repeated clicks don't pile up empty chats
    const current = getActiveChat();
    if (!current || current.messages.length > 0) {
        const chat = {
            id: Date.now(),
            sessionId: null,
            title: 'New chat',
            messages: [],
            pending: false
        };
        chats.unshift(chat);
        activeChatId = chat.id;
    }
    saveChats();
    renderActiveChat();
    renderChatList();
}

function switchChat(chatId) {
    activeChatId = chatId;
    saveChats();
    renderActiveChat();
    renderChatList();
}

function renderActiveChat() {
    const chat = getActiveChat();
    chatMessages.innerHTML = '';
    addMessage(WELCOME_MESSAGE, 'assistant', null, true);
    if (!chat) return;

    chat.messages.forEach(message => {
        addMessage(message.content, message.type, message.sources);
    });

    if (chat.pending) {
        chatMessages.appendChild(createLoadingMessage());
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Input is only locked while this chat is waiting for a reply
    chatInput.disabled = chat.pending;
    sendButton.disabled = chat.pending;
}

function renderChatList() {
    chatList.innerHTML = '';
    chats
        .filter(chat => chat.messages.length > 0)
        .forEach(chat => {
            const item = document.createElement('button');
            item.className = 'chat-list-item';
            if (chat.id === activeChatId) item.classList.add('active');
            if (chat.pending) item.classList.add('pending');
            item.textContent = chat.title;
            item.title = chat.title;
            item.addEventListener('click', () => switchChat(chat.id));
            chatList.appendChild(item);
        });
}

// Load course statistics
async function loadCourseStats() {
    try {
        console.log('Loading course stats...');
        const response = await fetch(`${API_URL}/courses`);
        if (!response.ok) throw new Error('Failed to load course stats');
        
        const data = await response.json();
        console.log('Course data received:', data);
        
        // Update stats in UI
        if (totalCourses) {
            totalCourses.textContent = data.total_courses;
        }
        
        // Update course titles
        if (courseTitles) {
            if (data.course_titles && data.course_titles.length > 0) {
                courseTitles.innerHTML = data.course_titles
                    .map(title => `<div class="course-title-item">${title}</div>`)
                    .join('');
            } else {
                courseTitles.innerHTML = '<span class="no-courses">No courses available</span>';
            }
        }
        
    } catch (error) {
        console.error('Error loading course stats:', error);
        // Set default values on error
        if (totalCourses) {
            totalCourses.textContent = '0';
        }
        if (courseTitles) {
            courseTitles.innerHTML = '<span class="error">Failed to load courses</span>';
        }
    }
}