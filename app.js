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
            window.firebaseAuth.onAuthStateChanged(auth, (user) => {
                if (user && user.email) {
                    currentUser = user;
                    currentUsername = user.email.split('@')[0];
                    console.log("Signed in as:", currentUsername);

                    loadingEl.style.display = "none";
                    authSection.style.display = "none";
                    lobbyUsernameDisplay.innerText = currentUsername;
                    if (!currentRoomCode) {
                        lobbySection.style.display = "block";
                    }
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

        document.getElementById("back-to-lobby-btn").onclick = () => {
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

    // --- TURN MECHANICS (DRAW & DISCARD) ---
    let localGameState = null;
    let selectedDrawnCard = null; // Holds the card drawn from the deck on your turn
    let activePower = null; // null, 'peek_own', 'peek_other', 'swap_1', 'swap_2'
    let swapCard1 = null; // { uid, index }



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
            discardPileEl.onclick = drawFromDiscard;
            deckEl.classList.add("selectable");
            discardPileEl.classList.add("selectable");
        } else {
            deckEl.classList.remove("selectable");
            discardPileEl.classList.remove("selectable");
        }

        // Make local hand cards clickable for swapping or powers/stacking
        const localCards = document.getElementById("local-player-cards").children;
        for (let i = 0; i < localCards.length; i++) {
            localCards[i].onclick = null;
            localCards[i].classList.remove("selectable");

            // Stacking out of turn OR standard interaction
            if (activePower === 'peek_own' || activePower === 'swap_1' || activePower === 'swap_2') {
                if (isMyTurn) {
                    localCards[i].classList.add("selectable");
                    localCards[i].onclick = () => handlePowerClick(currentUser.uid, i);
                }
            } else if (isMyTurn && selectedDrawnCard) {
                localCards[i].classList.add("selectable");
                localCards[i].onclick = () => swapDrawnCardWithHand(i);
            } else if (!activePower && !selectedDrawnCard) {
                // Allow stacking at any time if we aren't busy
                localCards[i].classList.add("selectable");
                localCards[i].onclick = () => attemptStack(i);
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

        // Manage Stacking Mode / Stacking Alert
        const stackAlertEl = document.getElementById("stack-alert");
        if (stackAlertEl) {
            if (!activePower && !selectedDrawnCard && localGameState.status === "playing") {
                stackAlertEl.classList.remove("hidden");
                stackAlertEl.innerText = "STACKING MODE (Click card to stack)";
                for (let i = 0; i < localCards.length; i++) {
                    localCards[i].classList.add("stack-target");
                }
            } else {
                stackAlertEl.classList.add("hidden");
                for (let i = 0; i < localCards.length; i++) {
                    localCards[i].classList.remove("stack-target");
                }
            }
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
                discardPile: newDiscard
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

        // 3. Update UI to show the card they drew
        document.getElementById("action-prompt").innerText = "You drew: " + drawnCard.value + ". Select a card in your hand to swap, or click Discard to discard it.";
        document.getElementById("action-prompt").classList.remove("hidden");

        // 4. Temporarily update Firebase deck so others see the card is gone
        await window.firebaseDb.update(roomRef, { deck: newDeck });
        attachInteractionListeners();
    }

    async function drawFromDiscard() {
        if (!localGameState || !localGameState.discardPile || localGameState.discardPile.length === 0) return;

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

        // Clean up fromDiscard flag
        delete selectedDrawnCard.fromDiscard;

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
        selectedDrawnCard = null;

        // Check for special powers
        const val = discardedCard.value;
        if (val === '7' || val === '8') {
            activePower = 'peek_own';
            document.getElementById("action-prompt").innerText = "Power! Select one of YOUR cards to peek at.";
        } else if (val === '9' || val === '10') {
            activePower = 'peek_other';
            document.getElementById("action-prompt").innerText = "Power! Select an OPPONENT'S card to peek at.";
        } else if (val === 'J' || val === 'Q') {
            activePower = 'swap_1';
            document.getElementById("action-prompt").innerText = "Power! Select ANY card (yours or opponent's) to swap.";
        } else {
            activePower = null;
        }

        if (activePower) {
            // Wait for user interaction to finish the turn
            await window.firebaseDb.update(roomRef, { discardPile: newDiscardPile });
            attachInteractionListeners();
        } else {
            document.getElementById("action-prompt").classList.add("hidden");
            const turnResult = calculateNextTurn();
            await window.firebaseDb.update(roomRef, {
                discardPile: newDiscardPile,
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
});
