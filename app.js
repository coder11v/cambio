// Replace this with your actual Cloudflare Worker URL
const WORKER_URL = "https://cambio.veerbajaj11.workers.dev";

let db, auth, currentUser, currentUsername;
let currentRoomCode = null;
let isHost = false;
let roomRef = null;

// Helper to generate a random 4-letter room code
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

document.addEventListener("DOMContentLoaded", () => {
    console.log("App loaded. Fetching Firebase config from Worker...");

    // Fetch and display version from assets/config.json
    fetch('assets/config.json')
        .then(response => response.json())
        .then(config => {
            const versionDisplay = document.getElementById("version-display");
            if (versionDisplay) {
                versionDisplay.innerText = "v" + config.version;
            }
        })
        .catch(err => {
            console.error("Error loading assets/config.json version:", err);
        });

    // Parse URL query parameter ?room=XXXX
    const urlParams = new URLSearchParams(window.location.search);
    const sharedRoomCode = urlParams.get('room');
    if (sharedRoomCode && sharedRoomCode.length === 4) {
        localStorage.setItem('pendingRoomCode', sharedRoomCode.toUpperCase());
        // Clean URL parameter
        const newUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
    }

    // UI Elements
    const loadingEl = document.getElementById("loading");
    const authSection = document.getElementById("auth-section");
    const authUsernameInput = document.getElementById("auth-username");
    const authPasswordInput = document.getElementById("auth-password");
    const loginBtn = document.getElementById("login-btn");
    const signupBtn = document.getElementById("signup-btn");
    const signoutBtn = document.getElementById("signout-btn");
    const lobbyUsernameDisplay = document.getElementById("lobby-username-display");
    const authErrorEl = document.getElementById("auth-error");

    const adminSection = document.getElementById("admin-section");
    const adminSignoutBtn = document.getElementById("admin-signout-btn");
    const adminRoomsList = document.getElementById("admin-rooms-list");
    const adminEndedOverlay = document.getElementById("admin-ended-overlay");
    const adminEndedCloseBtn = document.getElementById("admin-ended-close-btn");

    const lobbySection = document.getElementById("lobby-section");
    const waitingRoomSection = document.getElementById("waiting-room-section");
    const gameBoardSection = document.getElementById("game-board-section");
    const createRoomBtn = document.getElementById("create-room-btn");
    const roomCodeInput = document.getElementById("room-code-input");
    const joinRoomBtn = document.getElementById("join-room-btn");

    const displayRoomCode = document.getElementById("display-room-code");
    const playersList = document.getElementById("players-list");
    const startGameBtn = document.getElementById("start-game-btn");
    const waitingMessage = document.getElementById("waiting-message");

    // Rules Modal Logic
    const rulesToggleBtn = document.getElementById("rules-toggle-btn");
    const closeRulesBtn = document.getElementById("close-rules-btn");
    const rulesModal = document.getElementById("rules-modal");

    rulesToggleBtn.addEventListener("click", () => {
        rulesModal.classList.remove("hidden");
    });

    closeRulesBtn.addEventListener("click", () => {
        rulesModal.classList.add("hidden");
    });

    window.addEventListener("click", (event) => {
        if (event.target === rulesModal) {
            rulesModal.classList.add("hidden");
        }
    });

    // Fetch config
    fetch(WORKER_URL)
        .then(response => {
            if (!response.ok) {
                throw new Error("Network response was not ok");
            }
            return response.json();
        })
        .then(firebaseConfig => {
            console.log("Firebase config loaded successfully.");

            // Initialize Firebase
            const app = window.firebaseApp.initializeApp(firebaseConfig);
            db = window.firebaseDb.getDatabase(app);
            auth = window.firebaseAuth.getAuth(app);

            // Keep track of local state for interactions
            window.firebaseDb.onValue(window.firebaseDb.ref(db, 'rooms'), (snapshot) => {
                if (currentRoomCode && snapshot.val() && snapshot.val()[currentRoomCode]) {
                    localGameState = snapshot.val()[currentRoomCode];
                    attachInteractionListeners();
                }
            });

            // Authentication state changes
            window.firebaseAuth.onAuthStateChanged(auth, async (user) => {
                if (user && user.email) {
                    currentUser = user;
                    currentUsername = user.email.split('@')[0];
                    console.log("Signed in as:", currentUsername);

                    loadingEl.style.display = "none";
                    authSection.style.display = "none";
                    lobbyUsernameDisplay.innerText = currentUsername;

                    if (currentUsername === "veeradmin") {
                        loadAdminDashboard();
                        return;
                    }

                    // Read pending room code from sharing link
                    const pendingRoom = localStorage.getItem('pendingRoomCode');

                    const autoJoinRoom = async (code) => {
                        try {
                            const targetRoomRef = window.firebaseDb.ref(db, `rooms/${code}`);
                            const snap = await window.firebaseDb.get(targetRoomRef);

                            if (!snap.exists()) {
                                alert(`Room ${code} not found!`);
                                lobbySection.style.display = "block";
                                return;
                            }

                            const roomData = snap.val();
                            if (roomData.status !== "waiting") {
                                alert("Game already in progress!");
                                lobbySection.style.display = "block";
                                return;
                            }

                            const currentPlayers = Object.keys(roomData.players || {}).length;
                            if (currentPlayers >= 8) {
                                alert("Room is full! (Max 8 players)");
                                lobbySection.style.display = "block";
                                return;
                            }

                            currentRoomCode = code;
                            roomRef = targetRoomRef;

                            // Add player to room
                            await window.firebaseDb.update(window.firebaseDb.ref(db, `rooms/${currentRoomCode}/players/${currentUser.uid}`), {
                                name: currentUsername,
                                order: currentPlayers,
                                isHost: false
                            });

                            enterWaitingRoom();
                        } catch (err) {
                            console.error("Auto join error:", err);
                            lobbySection.style.display = "block";
                        }
                    };

                    // Query the database to see which rooms this player is currently in
                    const checkUserRooms = async () => {
                        try {
                            const roomsRef = window.firebaseDb.ref(db, 'rooms');
                            const snapshot = await window.firebaseDb.get(roomsRef);
                            const rooms = snapshot.val() || {};

                            const activeRooms = [];
                            for (const code in rooms) {
                                const room = rooms[code];
                                if (room.players && room.players[currentUser.uid]) {
                                    activeRooms.push({ code: code, room: room });
                                }
                            }

                            // Hide all main containers first
                            lobbySection.style.display = "none";
                            document.getElementById("multiple-rooms-section").style.display = "none";
                            waitingRoomSection.style.display = "none";
                            gameBoardSection.style.display = "none";
                            adminSection.style.display = "none";

                            if (activeRooms.length === 1) {
                                // Rejoin the single active room
                                const targetRoom = activeRooms[0];
                                console.log("Auto-rejoining room:", targetRoom.code);
                                currentRoomCode = targetRoom.code;
                                roomRef = window.firebaseDb.ref(db, `rooms/${currentRoomCode}`);
                                isHost = (targetRoom.room.host === currentUser.uid);
                                enterWaitingRoom();
                            } else if (activeRooms.length > 1) {
                                // Registered in multiple rooms - show error and allow them to leave/delete
                                const multiSection = document.getElementById("multiple-rooms-section");
                                const listContainer = document.getElementById("multiple-rooms-list");
                                listContainer.innerHTML = "";

                                activeRooms.forEach(({ code, room }) => {
                                    const isRoomHost = room.host === currentUser.uid;
                                    const item = document.createElement("div");
                                    item.style.padding = "10px";
                                    item.style.border = "1px solid #2d3748";
                                    item.style.marginBottom = "10px";
                                    item.style.display = "flex";
                                    item.style.justifyContent = "space-between";
                                    item.style.alignItems = "center";

                                    const info = document.createElement("span");
                                    info.innerText = `Room: ${code} ${isRoomHost ? '(Host)' : '(Guest)'}`;
                                    item.appendChild(info);

                                    const actionBtn = document.createElement("button");
                                    actionBtn.innerText = isRoomHost ? "Delete" : "Leave";
                                    actionBtn.style.backgroundColor = "#e74c3c";
                                    actionBtn.style.borderColor = "#e74c3c";
                                    actionBtn.style.padding = "4px 8px";
                                    actionBtn.style.fontSize = "0.85em";

                                    actionBtn.onclick = async () => {
                                        actionBtn.disabled = true;
                                        try {
                                            if (isRoomHost) {
                                                await window.firebaseDb.set(window.firebaseDb.ref(db, `rooms/${code}`), null);
                                            } else {
                                                await window.firebaseDb.set(window.firebaseDb.ref(db, `rooms/${code}/players/${currentUser.uid}`), null);
                                            }
                                            // Re-scan
                                            await checkUserRooms();
                                        } catch (err) {
                                            console.error("Error leaving/deleting room:", err);
                                            actionBtn.disabled = false;
                                        }
                                    };

                                    item.appendChild(actionBtn);
                                    listContainer.appendChild(item);
                                });

                                multiSection.style.display = "block";
                            } else {
                                if (pendingRoom) {
                                    localStorage.removeItem('pendingRoomCode');
                                    await autoJoinRoom(pendingRoom);
                                } else {
                                    lobbySection.style.display = "block";
                                }
                            }
                        } catch (err) {
                            console.error("Auto-rejoin query error:", err);
                            lobbySection.style.display = "block";
                        }
                    };

                    await checkUserRooms();
                } else {
                    currentUser = null;
                    currentUsername = null;
                    loadingEl.style.display = "none";
                    lobbySection.style.display = "none";
                    authSection.style.display = "block";
                }
            });

            // Login, Signup, Signout button events
            loginBtn.addEventListener("click", () => {
                const username = authUsernameInput.value.trim().toLowerCase();
                const password = authPasswordInput.value;
                if (!username || !password) {
                    authErrorEl.innerText = "Enter both username and password!";
                    return;
                }
                authErrorEl.innerText = "";

                const email = `${username}@cambio.veerbajaj.com`;
                window.firebaseAuth.signInWithEmailAndPassword(auth, email, password)
                    .catch(err => {
                        authErrorEl.innerText = "Error: " + err.message;
                    });
            });

            signupBtn.addEventListener("click", () => {
                const username = authUsernameInput.value.trim().toLowerCase();
                const password = authPasswordInput.value;
                if (!username || !password) {
                    authErrorEl.innerText = "Enter both username and password!";
                    return;
                }
                if (username.length < 3) {
                    authErrorEl.innerText = "Username must be at least 3 characters!";
                    return;
                }
                authErrorEl.innerText = "";

                const email = `${username}@cambio.veerbajaj.com`;
                window.firebaseAuth.createUserWithEmailAndPassword(auth, email, password)
                    .catch(err => {
                        authErrorEl.innerText = "Error: " + err.message;
                    });
            });

            signoutBtn.addEventListener("click", () => {
                window.firebaseAuth.signOut(auth)
                    .catch(err => console.error("Signout Error:", err));
            });

            adminSignoutBtn.addEventListener("click", () => {
                window.firebaseAuth.signOut(auth)
                    .catch(err => console.error("Signout Error:", err));
            });

            adminEndedCloseBtn.addEventListener("click", async () => {
                adminEndedOverlay.classList.add("hidden");
                try {
                    if (currentRoomCode) {
                        if (isHost) {
                            await window.firebaseDb.set(window.firebaseDb.ref(db, `rooms/${currentRoomCode}`), null);
                        } else {
                            await window.firebaseDb.set(window.firebaseDb.ref(db, `rooms/${currentRoomCode}/players/${currentUser.uid}`), null);
                        }
                    }
                } catch (err) {
                    console.error("Error cleaning up room on admin end:", err);
                }
                currentRoomCode = null;
                roomRef = null;
                isHost = false;
                location.reload();
            });
        })
        .catch(error => {
            console.error("Error fetching Firebase config:", error);
            loadingEl.innerText = "Error loading config. Did you deploy your Worker and set WORKER_URL in app.js?";
        });

    // Lobby Logic
    createRoomBtn.addEventListener("click", async () => {
        if (!currentUsername) return alert("You must be logged in!");
        const name = currentUsername;

        currentRoomCode = generateRoomCode();
        isHost = true;

        const initialRoomState = {
            status: "waiting", // waiting, playing, finished
            host: currentUser.uid,
            players: {
                [currentUser.uid]: {
                    name: name,
                    order: 0,
                    isHost: true
                }
            }
        };

        roomRef = window.firebaseDb.ref(db, `rooms/${currentRoomCode}`);
        await window.firebaseDb.set(roomRef, initialRoomState);

        enterWaitingRoom();
    });

    joinRoomBtn.addEventListener("click", async () => {
        if (!currentUsername) return alert("You must be logged in!");
        const name = currentUsername;
        const code = roomCodeInput.value.trim().toUpperCase();

        if (code.length !== 4) return alert("Room code must be 4 letters!");

        const targetRoomRef = window.firebaseDb.ref(db, `rooms/${code}`);
        const snapshot = await window.firebaseDb.get(targetRoomRef);

        if (!snapshot.exists()) {
            return alert("Room not found!");
        }

        const roomData = snapshot.val();
        if (roomData.status !== "waiting") {
            return alert("Game already in progress!");
        }

        const currentPlayers = Object.keys(roomData.players || {}).length;
        if (currentPlayers >= 8) {
            return alert("Room is full! (Max 8 players)");
        }

        currentRoomCode = code;
        roomRef = targetRoomRef;

        // Add player to room
        await window.firebaseDb.update(window.firebaseDb.ref(db, `rooms/${currentRoomCode}/players/${currentUser.uid}`), {
            name: name,
            order: currentPlayers, // simple ordering for now
            isHost: false
        });

        enterWaitingRoom();
    });

    function enterWaitingRoom() {
        lobbySection.style.display = "none";
        waitingRoomSection.style.display = "block";
        displayRoomCode.innerText = currentRoomCode;

        if (isHost) {
            startGameBtn.style.display = "inline-block";
            waitingMessage.style.display = "none";
        }

        // Listen for room changes
        window.firebaseDb.onValue(roomRef, (snapshot) => {
            const data = snapshot.val();
            if (!data) return; // Room deleted

            localGameState = data;
            isHost = (data.host === currentUser.uid);

            if (data.status === "ended_by_admin") {
                adminEndedOverlay.classList.remove("hidden");
                if (simulationInterval) {
                    clearInterval(simulationInterval);
                    simulationInterval = null;
                }
                return;
            }

            // Update player list
            playersList.innerHTML = "";
            const players = data.players || {};

            // Sort by order to show consistent list
            const sortedPlayers = Object.values(players).sort((a, b) => a.order - b.order);

            sortedPlayers.forEach(p => {
                const li = document.createElement("li");
                li.innerText = p.name + (p.isHost ? " (Host)" : "");
                playersList.appendChild(li);
            });

            // Check if game started or finished
            if (data.status === "starting" || data.status === "playing" || data.status === "finished") {
                waitingRoomSection.style.display = "none";
                gameBoardSection.style.display = "flex";
                document.getElementById("game-room-code").innerText = currentRoomCode;

                renderGameBoard(data);
                attachInteractionListeners();

                // If host, check if all players are ready
                if (isHost && data.status === "starting") {
                    const allReady = Object.values(data.players).every(p => p.hasLookedAtStartingCards);
                    if (allReady) {
                        window.firebaseDb.update(roomRef, { status: "playing" });
                    }
                }
            }
        });
    }

    // --- RENDER GAME BOARD ---
    function renderGameBoard(roomData) {
        if (roomData.status === "finished") {
            renderResults(roomData);
            return;
        }

        // 1. Update Deck Count
        document.getElementById("deck-count-val").innerText = roomData.deck ? roomData.deck.length : 0;

        // 1.5 Update Drawn Card Slot
        const drawnCardContainer = document.getElementById("drawn-card-container");
        const drawnCardEl = document.getElementById("drawn-card");
        if (selectedDrawnCard) {
            drawnCardContainer.classList.remove("hidden");
            drawnCardEl.className = `card ${selectedDrawnCard.color}`;
            drawnCardEl.innerHTML = `
                <div class="card-value">${selectedDrawnCard.value}</div>
                <div class="card-suit">${getSuitSymbol(selectedDrawnCard.suit)}</div>
                <div class="card-bottom-value">${selectedDrawnCard.value}</div>
            `;
        } else {
            drawnCardContainer.classList.add("hidden");
            if (drawnCardEl) drawnCardEl.innerHTML = "";
        }

        // 2. Update Discard Pile
        const discardPileEl = document.getElementById("discard-pile");
        if (roomData.discardPile && roomData.discardPile.length > 0) {
            const topCard = roomData.discardPile[roomData.discardPile.length - 1];
            discardPileEl.className = `card ${topCard.color}`;
            discardPileEl.innerHTML = `
                <div class="card-value">${topCard.value}</div>
                <div class="card-suit">${getSuitSymbol(topCard.suit)}</div>
                <div class="card-bottom-value">${topCard.value}</div>
            `;
        } else {
            discardPileEl.className = "card empty-slot";
            discardPileEl.innerHTML = "";
        }

        // 3. Render Players
        const opponentsContainer = document.getElementById("opponents-container");
        const localCardsContainer = document.getElementById("local-player-cards");

        opponentsContainer.innerHTML = "";
        localCardsContainer.innerHTML = "";

        const turnOrder = roomData.turnOrder || [];
        const currentTurnUid = turnOrder[roomData.currentTurnIndex];

        turnOrder.forEach(uid => {
            const player = roomData.players[uid];
            const isLocal = uid === currentUser.uid;
            const isTheirTurn = uid === currentTurnUid;

            if (isLocal) {
                // Render local player
                document.getElementById("local-player-name").innerText = `${player.name} (You)`;
                document.getElementById("local-player-status").innerText = isTheirTurn ? "YOUR TURN" : "";

                const cards = player.cards || [];
                cards.forEach((card, index) => {
                    const cardEl = document.createElement("div");
                    cardEl.className = "card";
                    cardEl.dataset.index = index;

                    // Logic to show bottom 2 cards during "starting" phase
                    if (roomData.status === "starting" && !player.hasLookedAtStartingCards && (index === 2 || index === 3)) {
                        cardEl.classList.add(card.color);
                        cardEl.innerHTML = `
                            <div class="card-value">${card.value}</div>
                            <div class="card-suit">${getSuitSymbol(card.suit)}</div>
                            <div class="card-bottom-value">${card.value}</div>
                        `;
                    } else {
                        cardEl.innerHTML = `<div class="card-back">CAMBIO</div>`;
                    }

                    localCardsContainer.appendChild(cardEl);
                });

                // Add acknowledge button during start phase
                if (roomData.status === "starting" && !player.hasLookedAtStartingCards) {
                    const btn = document.createElement("button");
                    btn.innerText = "Ready!";
                    btn.onclick = () => acknowledgeStartCards();
                    document.getElementById("local-player-status").innerHTML = "";
                    document.getElementById("local-player-status").appendChild(btn);
                }

            } else {
                // Render opponent
                const oppDiv = document.createElement("div");
                oppDiv.className = "opponent";
                oppDiv.dataset.uid = uid;
                if (isTheirTurn) oppDiv.style.border = "2px solid #f1c40f";

                const nameTag = document.createElement("h4");
                nameTag.innerText = player.name;
                oppDiv.appendChild(nameTag);

                const cardsGrid = document.createElement("div");
                cardsGrid.className = "player-cards-grid";

                const cards = player.cards || [];
                cards.forEach((card, index) => {
                    const cardEl = document.createElement("div");
                    cardEl.className = "card";
                    cardEl.innerHTML = `<div class="card-back">CAMBIO</div>`;
                    cardsGrid.appendChild(cardEl);
                });

                oppDiv.appendChild(cardsGrid);
                opponentsContainer.appendChild(oppDiv);
            }
        });

        // General Game Messages
        const msgEl = document.getElementById("game-messages");
        if (roomData.status === "starting") {
            msgEl.innerText = "Memorize your bottom two cards!";
            document.getElementById("cambio-btn").style.display = "none";
        } else if (roomData.status === "playing") {
            const currentName = roomData.players[currentTurnUid].name;
            msgEl.innerText = currentTurnUid === currentUser.uid ? "It is your turn!" : `Waiting for ${currentName}...`;

            // Handle Cambio button
            const cambioBtn = document.getElementById("cambio-btn");
            if (currentTurnUid === currentUser.uid && !roomData.cambioCalledBy && !selectedDrawnCard && !activePower) {
                cambioBtn.style.display = "block";
                cambioBtn.onclick = callCambio;
            } else {
                cambioBtn.style.display = "none";
            }

            // Handle Simulate button
            const players = Object.values(roomData.players || {});
            const allVeerTest = players.length > 0 && players.every(p => p.name.startsWith("veertest"));
            const simulateBtn = document.getElementById("simulate-btn");
            if (isHost && allVeerTest) {
                simulateBtn.style.display = "inline-block";
                simulateBtn.onclick = startSimulation;
            } else {
                simulateBtn.style.display = "none";
            }

            if (roomData.cambioCalledBy) {
                const callerName = roomData.players[roomData.cambioCalledBy].name;
                msgEl.innerText += ` | CAMBIO called by ${callerName}! Final turn.`;
            }
        }
    }

    function renderResults(roomData) {
        document.getElementById("game-board-section").style.display = "none";
        document.getElementById("results-section").style.display = "block";

        const resultsList = document.getElementById("results-list");
        resultsList.innerHTML = "";

        let scores = [];

        for (const uid in roomData.players) {
            const player = roomData.players[uid];
            let score = 0;
            const cards = player.cards || [];
            cards.forEach(card => {
                score += card.numValue;
            });
            scores.push({ name: player.name, score: score, cards: cards });
        }

        // Sort lowest score first
        scores.sort((a, b) => a.score - b.score);

        scores.forEach((s, index) => {
            const div = document.createElement("div");
            div.style.marginBottom = "15px";
            div.innerHTML = `<h3>#${index + 1}: ${s.name} - ${s.score} points</h3>
                             <p>Cards: ${(s.cards || []).map(c => c.value).join(', ')}</p>`;
            resultsList.appendChild(div);
        });

        document.getElementById("back-to-lobby-btn").onclick = async () => {
            try {
                if (isHost) {
                    // Host deletes the entire room
                    await window.firebaseDb.set(roomRef, null);
                } else {
                    // Guest removes themselves from the player list
                    const playerRef = window.firebaseDb.ref(db, `rooms/${currentRoomCode}/players/${currentUser.uid}`);
                    await window.firebaseDb.set(playerRef, null);
                }
            } catch (err) {
                console.error("Error leaving room:", err);
            }
            location.reload(); // Simple way to reset
        };
    }

    function getSuitSymbol(suit) {
        switch (suit) {
            case 'hearts': return '♥';
            case 'diamonds': return '♦';
            case 'clubs': return '♣';
            case 'spades': return '♠';
            default: return '🃏';
        }
    }

    async function acknowledgeStartCards() {
        // Use a transaction or simple update to mark this player as ready
        await window.firebaseDb.update(window.firebaseDb.ref(db, `rooms/${currentRoomCode}/players/${currentUser.uid}`), {
            hasLookedAtStartingCards: true
        });

        // Check if all players are ready, if so, move to playing status
        // Only host checks to prevent multiple writes
        if (isHost) {
            const snap = await window.firebaseDb.get(roomRef);
            const data = snap.val();
            const allReady = Object.values(data.players).every(p => p.hasLookedAtStartingCards);
            if (allReady) {
                await window.firebaseDb.update(roomRef, { status: "playing" });
            }
        }
    }

    let localGameState = null;
    let selectedDrawnCard = null; // Holds the card drawn from the deck on your turn
    let activePower = null; // null, 'peek_own', 'peek_other', 'swap_1', 'swap_2'
    let swapCard1 = null; // { uid, index }
    let simulationInterval = null;



    function attachInteractionListeners() {
        if (!localGameState || localGameState.status !== "playing") return;

        // Remove old opponent listeners to avoid duplicates
        document.querySelectorAll('.opponent .card').forEach(c => {
            c.onclick = null;
            c.classList.remove("selectable");
        });

        const turnOrder = localGameState.turnOrder || [];
        const currentTurnUid = turnOrder[localGameState.currentTurnIndex];
        const isMyTurn = currentTurnUid === currentUser.uid;

        // If it's my turn, make deck and discard interactive
        const deckEl = document.getElementById("deck");
        const discardPileEl = document.getElementById("discard-pile");

        deckEl.onclick = null;
        discardPileEl.onclick = null;

        if (isMyTurn && !selectedDrawnCard) {
            deckEl.onclick = drawFromDeck;
            deckEl.classList.add("selectable");

            if (!localGameState.discardPileFrozen) {
                discardPileEl.onclick = drawFromDiscard;
                discardPileEl.classList.add("selectable");
            } else {
                discardPileEl.classList.remove("selectable");
            }
        } else {
            deckEl.classList.remove("selectable");
            discardPileEl.classList.remove("selectable");
        }

        // Make local hand cards clickable for swapping or powers/stacking
        const localCardsContainer = document.getElementById("local-player-cards");
        const localCards = localCardsContainer.children;
        for (let i = 0; i < localCards.length; i++) {
            const cardEl = localCards[i];
            cardEl.onclick = null;
            cardEl.classList.remove("selectable");

            // Stacking out of turn OR standard interaction
            if (activePower === 'peek_own' || activePower === 'swap_1' || activePower === 'swap_2') {
                if (isMyTurn) {
                    cardEl.classList.add("selectable");
                    cardEl.onclick = () => handlePowerClick(currentUser.uid, i);
                }
            } else if (isMyTurn && selectedDrawnCard) {
                cardEl.classList.add("selectable");
                cardEl.onclick = () => swapDrawnCardWithHand(i);
            } else if (!activePower && !selectedDrawnCard) {
                // Allow stacking at any time if we aren't busy
                cardEl.classList.add("selectable");
                cardEl.onclick = () => attemptStack(i);
            }
        }

        // Opponent cards for powers
        if (isMyTurn && (activePower === 'peek_other' || activePower === 'swap_1' || activePower === 'swap_2')) {
            const opponentContainers = document.querySelectorAll('.opponent');
            opponentContainers.forEach(opp => {
                const oppUid = opp.dataset.uid;

                const cards = opp.querySelectorAll('.card');
                cards.forEach((card, index) => {
                    card.classList.add("selectable");
                    card.onclick = () => handlePowerClick(oppUid, index);
                });
            });
        }

        // Also if we have a selected card, we can discard it directly
        if (isMyTurn && selectedDrawnCard && !activePower) {
            // Discarding the drawn card directly
            discardPileEl.onclick = discardDrawnCard;
            discardPileEl.classList.add("selectable");
        }
    }

    async function attemptStack(handIndex) {
        if (!localGameState.discardPile || localGameState.discardPile.length === 0) return;
        const topDiscard = localGameState.discardPile[localGameState.discardPile.length - 1];

        const playerRef = window.firebaseDb.ref(db, `rooms/${currentRoomCode}/players/${currentUser.uid}`);
        const snap = await window.firebaseDb.get(playerRef);
        const player = snap.val();
        player.cards = player.cards || [];

        const cardToStack = player.cards[handIndex];

        if (cardToStack.value === topDiscard.value) {
            // Success! Remove from hand, add to discard
            player.cards.splice(handIndex, 1);
            const newDiscard = [...localGameState.discardPile, cardToStack];

            await window.firebaseDb.update(roomRef, {
                [`players/${currentUser.uid}`]: player,
                discardPile: newDiscard,
                discardPileFrozen: true
            });
            // Show a quick visual success if we want later
        } else {
            // Fail! Draw penalty card
            alert("Wrong card! You draw a penalty card.");
            const deckRef = window.firebaseDb.ref(db, `rooms/${currentRoomCode}/deck`);
            const deckSnap = await window.firebaseDb.get(deckRef);
            let deck = deckSnap.val() || [];

            if (deck.length > 0) {
                const penaltyCard = deck.pop();
                player.cards = player.cards || [];
                player.cards.push(penaltyCard);

                await window.firebaseDb.update(roomRef, {
                    [`players/${currentUser.uid}`]: player,
                    deck: deck
                });
            }
        }
    }

    async function drawFromDeck() {
        if (!localGameState || localGameState.deck.length === 0) return;

        // 1. Pop from deck
        const newDeck = [...localGameState.deck];
        const drawnCard = newDeck.pop();

        // 2. Update state locally to allow user choice (swap or discard)
        selectedDrawnCard = drawnCard;
        selectedDrawnCard.fromDeck = true;

        // 3. Update UI to show the card they drew
        document.getElementById("action-prompt").innerText = "You drew: " + drawnCard.value + ". Select a card in your hand to swap, or click Discard to discard it.";
        document.getElementById("action-prompt").classList.remove("hidden");

        // 4. Temporarily update Firebase deck so others see the card is gone
        await window.firebaseDb.update(roomRef, { deck: newDeck });
        attachInteractionListeners();
    }

    async function drawFromDiscard() {
        if (!localGameState || !localGameState.discardPile || localGameState.discardPile.length === 0) return;
        if (localGameState.discardPileFrozen) {
            alert("The discard pile is frozen because the top card was stacked!");
            return;
        }

        // Discard pile drawing MUST swap with a hand card immediately. 
        // We'll treat it as selectedDrawnCard but prevent immediate discard.
        const newDiscard = [...localGameState.discardPile];
        const drawnCard = newDiscard.pop();

        selectedDrawnCard = drawnCard;
        selectedDrawnCard.fromDiscard = true; // flag to prevent discarding it immediately back

        document.getElementById("action-prompt").innerText = "You picked up " + drawnCard.value + ". Select a card in your hand to swap.";
        document.getElementById("action-prompt").classList.remove("hidden");

        await window.firebaseDb.update(roomRef, { discardPile: newDiscard });
        attachInteractionListeners();
    }

    async function swapDrawnCardWithHand(handIndex) {
        if (!selectedDrawnCard) return;

        const playerRef = window.firebaseDb.ref(db, `rooms/${currentRoomCode}/players/${currentUser.uid}`);
        const snap = await window.firebaseDb.get(playerRef);
        const player = snap.val();
        player.cards = player.cards || [];

        // The card from the hand goes to discard
        const cardToDiscard = player.cards[handIndex];

        // Clean up fromDiscard / fromDeck flags
        delete selectedDrawnCard.fromDiscard;
        delete selectedDrawnCard.fromDeck;

        // The drawn card goes to the hand
        player.cards[handIndex] = selectedDrawnCard;

        const newDiscardPile = [...(localGameState.discardPile || []), cardToDiscard];

        selectedDrawnCard = null;
        document.getElementById("action-prompt").classList.add("hidden");

        // Proceed to next turn
        const turnResult = calculateNextTurn();

        await window.firebaseDb.update(roomRef, {
            [`players/${currentUser.uid}`]: player,
            discardPile: newDiscardPile,
            discardPileFrozen: false, // Unfreeze pile
            ...turnResult.updates
        });
    }

    async function discardDrawnCard() {
        if (!selectedDrawnCard) return;
        if (selectedDrawnCard.fromDiscard) {
            alert("You cannot immediately discard a card you just drew from the discard pile!");
            return;
        }

        const newDiscardPile = [...(localGameState.discardPile || []), selectedDrawnCard];
        const discardedCard = selectedDrawnCard;
        const wasFromDeck = selectedDrawnCard.fromDeck;
        selectedDrawnCard = null;

        // Check for special powers ONLY if drawn from the mystery deck
        const val = discardedCard.value;
        if (wasFromDeck && (val === '7' || val === '8')) {
            activePower = 'peek_own';
            document.getElementById("action-prompt").innerText = "Power! Select one of YOUR cards to peek at.";
        } else if (wasFromDeck && (val === '9' || val === '10')) {
            activePower = 'peek_other';
            document.getElementById("action-prompt").innerText = "Power! Select an OPPONENT'S card to peek at.";
        } else if (wasFromDeck && (val === 'J' || val === 'Q')) {
            activePower = 'swap_1';
            document.getElementById("action-prompt").innerText = "Power! Select ANY card (yours or opponent's) to swap.";
        } else {
            activePower = null;
        }

        if (activePower) {
            // Wait for user interaction to finish the turn
            await window.firebaseDb.update(roomRef, { discardPile: newDiscardPile, discardPileFrozen: false });
            attachInteractionListeners();
        } else {
            document.getElementById("action-prompt").classList.add("hidden");
            const turnResult = calculateNextTurn();
            await window.firebaseDb.update(roomRef, {
                discardPile: newDiscardPile,
                discardPileFrozen: false, // Unfreeze pile
                ...turnResult.updates
            });
        }
    }

    async function handlePowerClick(targetUid, cardIndex) {
        if (!activePower) return;

        const targetPlayer = localGameState.players[targetUid];
        targetPlayer.cards = targetPlayer.cards || [];
        const targetCard = targetPlayer.cards[cardIndex];

        if (activePower === 'peek_own' && targetUid === currentUser.uid) {
            showTemporaryCard(targetUid, cardIndex, targetCard);
            endTurnAfterPower();
        }
        else if (activePower === 'peek_other' && targetUid !== currentUser.uid) {
            showTemporaryCard(targetUid, cardIndex, targetCard);
            endTurnAfterPower();
        }
        else if (activePower === 'swap_1') {
            swapCard1 = { uid: targetUid, index: cardIndex };
            activePower = 'swap_2';
            document.getElementById("action-prompt").innerText = "Select a SECOND card to swap with.";
            attachInteractionListeners();
        }
        else if (activePower === 'swap_2') {
            // Cannot swap the exact same card with itself, but we'll allow same player if they misclick
            if (swapCard1.uid === targetUid && swapCard1.index === cardIndex) {
                alert("Choose a different card!");
                return;
            }

            const p1 = localGameState.players[swapCard1.uid];
            const p2 = localGameState.players[targetUid];
            p1.cards = p1.cards || [];
            p2.cards = p2.cards || [];

            const card1 = p1.cards[swapCard1.index];
            const card2 = p2.cards[cardIndex];

            p1.cards[swapCard1.index] = card2;
            p2.cards[cardIndex] = card1;

            let updates = {};
            updates[`players/${swapCard1.uid}`] = p1;
            updates[`players/${targetUid}`] = p2;

            swapCard1 = null;
            endTurnAfterPower(updates);
        }
    }

    function showTemporaryCard(uid, index, cardData) {
        // Find the visual element and flip it temporarily for the local user only
        let cardEl;
        if (uid === currentUser.uid) {
            cardEl = document.getElementById("local-player-cards").children[index];
        } else {
            // Find opponent
            const oppContainers = document.querySelectorAll('.opponent');
            oppContainers.forEach(opp => {
                if (opp.querySelector('h4').innerText === localGameState.players[uid].name) {
                    cardEl = opp.querySelectorAll('.card')[index];
                }
            });
        }

        if (cardEl) {
            const originalHtml = cardEl.innerHTML;
            const originalColor = cardEl.classList.contains('red') ? 'red' : (cardEl.classList.contains('black') ? 'black' : '');

            cardEl.classList.remove('red', 'black');
            cardEl.classList.add(cardData.color);
            cardEl.innerHTML = `
                <div class="card-value">${cardData.value}</div>
                <div class="card-suit">${getSuitSymbol(cardData.suit)}</div>
                <div class="card-bottom-value">${cardData.value}</div>
            `;

            setTimeout(() => {
                cardEl.innerHTML = originalHtml;
                cardEl.className = 'card ' + (originalColor ? originalColor : '');
            }, 3000); // show for 3 seconds
        }
    }

    async function endTurnAfterPower(additionalUpdates = {}) {
        activePower = null;
        document.getElementById("action-prompt").classList.add("hidden");

        const turnResult = calculateNextTurn();

        const updates = {
            ...turnResult.updates,
            ...additionalUpdates
        };

        await window.firebaseDb.update(roomRef, updates);
    }

    function startSimulation() {
        const simulateBtn = document.getElementById("simulate-btn");
        if (simulateBtn.disabled) return;
        simulateBtn.disabled = true;
        simulateBtn.innerText = "Simulating...";

        if (simulationInterval) clearInterval(simulationInterval);

        simulationInterval = setInterval(async () => {
            // Fetch the latest room state from Firebase
            const snap = await window.firebaseDb.get(roomRef);
            const roomData = snap.val();

            // If game is finished or not active, stop simulation
            if (!roomData || roomData.status !== "playing") {
                clearInterval(simulationInterval);
                simulationInterval = null;
                simulateBtn.disabled = false;
                simulateBtn.innerText = "Simulate Game";
                return;
            }

            const turnOrder = roomData.turnOrder || [];
            const currentTurnUid = turnOrder[roomData.currentTurnIndex];
            const activePlayer = roomData.players[currentTurnUid];
            const activePlayerCards = activePlayer.cards || [];

            // 1. Chance to call Cambio if total hand points are relatively low (e.g. <= 12 points)
            const currentScore = activePlayerCards.reduce((acc, c) => acc + (c.numValue || 0), 0);
            if (!roomData.cambioCalledBy && currentScore <= 12 && Math.random() < 0.35) {
                console.log(`[Sim] ${activePlayer.name} calling CAMBIO!`);
                const nextTurn = (roomData.currentTurnIndex + 1) % turnOrder.length;
                await window.firebaseDb.update(roomRef, {
                    cambioCalledBy: currentTurnUid,
                    currentTurnIndex: nextTurn
                });
                return;
            }

            // 2. Draw card: 80% deck, 20% discard (if not frozen)
            let drawFromDiscard = false;
            if (roomData.discardPile && roomData.discardPile.length > 0 && !roomData.discardPileFrozen) {
                if (Math.random() < 0.2) {
                    drawFromDiscard = true;
                }
            }

            if (drawFromDiscard) {
                const newDiscard = [...roomData.discardPile];
                const drawnCard = newDiscard.pop();
                const swapIdx = Math.floor(Math.random() * activePlayerCards.length);

                const cardToDiscard = activePlayerCards[swapIdx];
                activePlayerCards[swapIdx] = drawnCard;
                newDiscard.push(cardToDiscard);

                const nextIndex = (roomData.currentTurnIndex + 1) % turnOrder.length;
                let nextStatus = roomData.status;
                if (roomData.cambioCalledBy && turnOrder[nextIndex] === roomData.cambioCalledBy) {
                    nextStatus = "finished";
                }

                await window.firebaseDb.update(roomRef, {
                    [`players/${currentTurnUid}/cards`]: activePlayerCards,
                    discardPile: newDiscard,
                    discardPileFrozen: false,
                    currentTurnIndex: nextIndex,
                    status: nextStatus
                });
            } else {
                const newDeck = [...(roomData.deck || [])];
                if (newDeck.length === 0) {
                    await window.firebaseDb.update(roomRef, { status: "finished" });
                    return;
                }

                const drawnCard = newDeck.pop();

                // 50% swap with random card, 50% discard
                if (Math.random() < 0.5) {
                    const swapIdx = Math.floor(Math.random() * activePlayerCards.length);
                    const cardToDiscard = activePlayerCards[swapIdx];
                    activePlayerCards[swapIdx] = drawnCard;

                    const newDiscard = [...(roomData.discardPile || []), cardToDiscard];
                    const nextIndex = (roomData.currentTurnIndex + 1) % turnOrder.length;
                    let nextStatus = roomData.status;
                    if (roomData.cambioCalledBy && turnOrder[nextIndex] === roomData.cambioCalledBy) {
                        nextStatus = "finished";
                    }

                    await window.firebaseDb.update(roomRef, {
                        [`players/${currentTurnUid}/cards`]: activePlayerCards,
                        discardPile: newDiscard,
                        discardPileFrozen: false,
                        deck: newDeck,
                        currentTurnIndex: nextIndex,
                        status: nextStatus
                    });
                } else {
                    const newDiscard = [...(roomData.discardPile || []), drawnCard];
                    const val = drawnCard.value;
                    let updates = {
                        discardPile: newDiscard,
                        discardPileFrozen: false,
                        deck: newDeck
                    };

                    // Execute powers simple emulation
                    if (val === '7' || val === '8') {
                        console.log(`[Sim] ${activePlayer.name} peeks own card`);
                    } else if (val === '9' || val === '10') {
                        console.log(`[Sim] ${activePlayer.name} peeks opponent card`);
                    } else if (val === 'J' || val === 'Q') {
                        const pIds = Object.keys(roomData.players);
                        if (pIds.length >= 2) {
                            const pid1 = pIds[Math.floor(Math.random() * pIds.length)];
                            let pid2 = pIds[Math.floor(Math.random() * pIds.length)];
                            if (pid1 === pid2) {
                                pid2 = pIds[(pIds.indexOf(pid1) + 1) % pIds.length];
                            }
                            const hand1 = roomData.players[pid1].cards || [];
                            const hand2 = roomData.players[pid2].cards || [];
                            if (hand1.length > 0 && hand2.length > 0) {
                                const idx1 = Math.floor(Math.random() * hand1.length);
                                const idx2 = Math.floor(Math.random() * hand2.length);
                                const c1 = hand1[idx1];
                                const c2 = hand2[idx2];
                                hand1[idx1] = c2;
                                hand2[idx2] = c1;
                                updates[`players/${pid1}/cards`] = hand1;
                                updates[`players/${pid2}/cards`] = hand2;
                                console.log(`[Sim] Swap card between ${roomData.players[pid1].name} and ${roomData.players[pid2].name}`);
                            }
                        }
                    }

                    const nextIndex = (roomData.currentTurnIndex + 1) % turnOrder.length;
                    let nextStatus = roomData.status;
                    if (roomData.cambioCalledBy && turnOrder[nextIndex] === roomData.cambioCalledBy) {
                        nextStatus = "finished";
                    }

                    updates.currentTurnIndex = nextIndex;
                    updates.status = nextStatus;

                    await window.firebaseDb.update(roomRef, updates);
                }
            }
        }, 500);
    }

    function calculateNextTurn() {
        // If Cambio was called, check if this was the last turn
        if (localGameState.cambioCalledBy) {
            const nextIndex = (localGameState.currentTurnIndex + 1) % localGameState.turnOrder.length;
            const nextUid = localGameState.turnOrder[nextIndex];

            if (nextUid === localGameState.cambioCalledBy) {
                // We have wrapped around back to the caller. Game over.
                return { updates: { status: "finished" } };
            } else {
                return { updates: { currentTurnIndex: nextIndex } };
            }
        } else {
            const nextIndex = (localGameState.currentTurnIndex + 1) % localGameState.turnOrder.length;
            return { updates: { currentTurnIndex: nextIndex } };
        }
    }

    // Override original next turn logic in standard draw/discard actions
    // (Already partially using calculateNextTurn logic, let's update them)

    async function callCambio() {
        if (!localGameState || localGameState.turnOrder[localGameState.currentTurnIndex] !== currentUser.uid) return;

        const nextTurn = (localGameState.currentTurnIndex + 1) % localGameState.turnOrder.length;

        await window.firebaseDb.update(roomRef, {
            cambioCalledBy: currentUser.uid,
            currentTurnIndex: nextTurn
        });
    }

    // --- CORE GAME LOGIC (DECK & DEALING) ---

    function generateDeck(playerCount) {
        // 4 players = 1 deck (54 cards), 8 players = 2 decks, etc.
        const numDecks = Math.ceil(playerCount / 4);
        const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
        const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

        let deck = [];
        let cardId = 0;

        for (let d = 0; d < numDecks; d++) {
            // Standard cards
            for (let s of suits) {
                for (let v of values) {
                    let numericValue = 0;
                    if (v === 'A') numericValue = 1;
                    else if (['J', 'Q', 'K'].includes(v)) {
                        if (v === 'K' && (s === 'hearts' || s === 'diamonds')) {
                            numericValue = -1; // Red King
                        } else {
                            numericValue = 10; // Black King, J, Q
                        }
                    } else {
                        numericValue = parseInt(v);
                    }

                    deck.push({
                        id: `c_${cardId++}`,
                        suit: s,
                        value: v,
                        numValue: numericValue,
                        color: (s === 'hearts' || s === 'diamonds') ? 'red' : 'black'
                    });
                }
            }
            // Jokers (2 per deck)
            deck.push({ id: `c_${cardId++}`, suit: 'none', value: 'JOKER', numValue: 0, color: 'black' });
            deck.push({ id: `c_${cardId++}`, suit: 'none', value: 'JOKER', numValue: 0, color: 'red' });
        }

        // Shuffle
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        return deck;
    }

    startGameBtn.addEventListener("click", async () => {
        if (!isHost) return;

        // 1. Get current players to know how many decks to make
        const snapshot = await window.firebaseDb.get(roomRef);
        const roomData = snapshot.val();
        const players = roomData.players || {};
        const playerIds = Object.keys(players);

        // 2. Generate and shuffle deck
        let deck = generateDeck(playerIds.length);

        // 3. Deal cards to players
        let dealtPlayers = {};
        playerIds.forEach(pid => {
            // Take 4 cards
            const hand = [deck.pop(), deck.pop(), deck.pop(), deck.pop()];
            dealtPlayers[pid] = {
                ...players[pid],
                cards: hand,
                hasLookedAtStartingCards: false
            };
        });

        // 4. Set first discard
        let discardPile = [deck.pop()];

        // 5. Initialize game state in Firebase
        await window.firebaseDb.update(roomRef, {
            status: "starting", // We use 'starting' phase so players can look at bottom 2 cards
            players: dealtPlayers,
            deck: deck,
            discardPile: discardPile,
            currentTurnIndex: 0, // Player order 0 goes first
            turnOrder: playerIds.sort((a, b) => players[a].order - players[b].order) // array of UIDs in order
        });
    });

    let adminRoomsListener = null;

    function loadAdminDashboard() {
        lobbySection.style.display = "none";
        waitingRoomSection.style.display = "none";
        gameBoardSection.style.display = "none";
        document.getElementById("multiple-rooms-section").style.display = "none";
        adminSection.style.display = "block";

        if (adminRoomsListener) {
            // Off the listener if already exists to prevent leaks
            adminRoomsListener = null;
        }

        const roomsRef = window.firebaseDb.ref(db, 'rooms');
        window.firebaseDb.onValue(roomsRef, (snapshot) => {
            const rooms = snapshot.val() || {};
            adminRoomsList.innerHTML = "";

            const codes = Object.keys(rooms);
            const activeCodes = codes.filter(code => rooms[code] && rooms[code].status !== "ended_by_admin");
            if (activeCodes.length === 0) {
                adminRoomsList.innerHTML = "<p style='color: #a0aec0; text-align: center;'>No active room sessions.</p>";
                return;
            }

            activeCodes.forEach(code => {
                const room = rooms[code];
                const item = document.createElement("div");
                item.className = "admin-room-item";

                const info = document.createElement("div");
                info.className = "admin-room-info";
                
                const hostName = room.players && room.host && room.players[room.host] ? room.players[room.host].name : "Unknown";
                const pCount = room.players ? Object.keys(room.players).length : 0;
                const pNames = room.players ? Object.values(room.players).map(p => p.name).join(', ') : "None";

                info.innerHTML = `
                    <strong>Room Code: ${code}</strong> | Status: ${room.status}<br>
                    <span class="admin-room-players" style="font-size: 0.8em; color: #a0aec0;">Host: ${hostName} | Players (${pCount}): ${pNames}</span>
                `;
                item.appendChild(info);

                const actionBtn = document.createElement("button");
                actionBtn.innerText = "End Session";
                actionBtn.style.backgroundColor = "#e74c3c";
                actionBtn.style.borderColor = "#e74c3c";
                actionBtn.style.padding = "4px 8px";
                actionBtn.style.fontSize = "0.85em";

                actionBtn.onclick = async () => {
                    actionBtn.disabled = true;
                    try {
                        await window.firebaseDb.update(window.firebaseDb.ref(db, `rooms/${code}`), {
                            status: "ended_by_admin"
                        });
                    } catch (err) {
                        console.error("Error ending session:", err);
                        actionBtn.disabled = false;
                    }
                };

                item.appendChild(actionBtn);
                adminRoomsList.appendChild(item);
            });
        });
    }
});
