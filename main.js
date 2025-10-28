import { Player } from './player.js';
import { PlatformManager } from './platforms.js';
import { Controls } from './controls.js';
import { Replay } from './replay.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const replayCanvas = document.getElementById('replay-canvas');
const replayCtx = replayCanvas.getContext('2d');

const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const startButton = document.getElementById('start-button');
const restartButton = document.getElementById('restart-button');
const scoreDisplay = document.getElementById('score-display');
const scoreEl = document.getElementById('score');
const finalScoreEl = document.getElementById('final-score');
const highScoreEl = document.getElementById('high-score');

let player, platformManager, replay;
let cameraY = 0;
let score = 0;
let gameState = 'start';
let lastTime = 0;

let playerImg = new Image();
const platformImg = new Image();
platformImg.src = 'platform.png';

const controls = new Controls();
const room = new WebsimSocket();

let playerAvatarLoaded = false;

function createPlayerSVG(avatarUrl) {
    const size = 64; // SVG size
    const avatarSize = 24; // Circle for avatar
    const avatarX = (size - avatarSize) / 2;
    const avatarY = 10;

    return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <defs>
            <clipPath id="avatar-clip">
                <circle cx="${avatarX + avatarSize / 2}" cy="${avatarY + avatarSize / 2}" r="${avatarSize / 2}" />
            </clipPath>
        </defs>

        <!-- Antennae -->
        <line x1="26" y1="10" x2="20" y2="4" stroke="grey" stroke-width="2"/>
        <circle cx="20" cy="4" r="2" fill="#ee6c4d"/>
        <line x1="38" y1="10" x2="44" y2="4" stroke="grey" stroke-width="2"/>
        <circle cx="44" cy="4" r="2" fill="#ee6c4d"/>

        <!-- Head / Body -->
        <rect x="12" y="10" width="40" height="40" rx="8" fill="#98c1d9"/>

        <!-- Face with profile picture -->
        <image href="${avatarUrl}" x="${avatarX}" y="${avatarY}" height="${avatarSize}" width="${avatarSize}" clip-path="url(#avatar-clip)" />
    </svg>
    `;
}

async function loadPlayerAsset() {
    try {
        const currentUser = room.peers[room.clientId];
        if (currentUser && currentUser.avatarUrl) {
            // To avoid canvas tainting from cross-origin images, we fetch the avatar,
            // convert it to a Blob, and then create a local URL for it.
            const response = await fetch(currentUser.avatarUrl);
            if (!response.ok) throw new Error('Avatar fetch failed');
            const blob = await response.blob();
            const avatarObjectUrl = URL.createObjectURL(blob);

            const svgString = createPlayerSVG(avatarObjectUrl);
            const svgBlob = new Blob([svgString], {type: 'image/svg+xml'});
            const svgObjectUrl = URL.createObjectURL(svgBlob);
            
            // The object URLs should be revoked after the image loads to free up memory.
            const cleanup = () => {
                URL.revokeObjectURL(avatarObjectUrl);
                URL.revokeObjectURL(svgObjectUrl);
                playerImg.removeEventListener('load', cleanup);
                playerImg.removeEventListener('error', cleanup);
            };

            return new Promise((resolve) => {
                playerImg.addEventListener('load', () => {
                    cleanup();
                    playerAvatarLoaded = true;
                    resolve();
                });
                playerImg.addEventListener('error', () => {
                    cleanup();
                    console.warn("Failed to load SVG character, using default.");
                    playerImg.src = 'player.png'; // Set fallback
                    playerImg.onload = resolve; // Resolve on fallback load
                });
                playerImg.src = svgObjectUrl;
            });
        }
    } catch (error) {
        console.warn("Could not get user data or process avatar, using default player asset.", error);
    }

    // Fallback for no user, no avatar, or API errors
    return new Promise((resolve) => {
        playerImg.onload = resolve;
        playerImg.onerror = () => { /* This shouldn't fail but good to have */ resolve(); };
        playerImg.src = 'player.png';
    });
}


function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Set replay canvas resolution based on its display size
    const replayRect = replayCanvas.getBoundingClientRect();
    replayCanvas.width = replayRect.width * window.devicePixelRatio;
    replayCanvas.height = replayRect.height * window.devicePixelRatio;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function init() {
    player = new Player(canvas.width / 2, canvas.height - 100, playerImg);
    platformManager = new PlatformManager(canvas.width, canvas.height, platformImg);
    platformManager.generateInitialPlatforms();
    replay = new Replay();
    
    cameraY = 0;
    score = 0;
    scoreEl.textContent = 0;
    
    uiState('game');
    if (gameState !== 'playing') {
        gameState = 'playing';
        requestAnimationFrame(gameLoop);
    }
}

function uiState(state) {
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    scoreDisplay.classList.add('hidden');

    if (state === 'start') {
        startScreen.classList.remove('hidden');
    } else if (state === 'game') {
        scoreDisplay.classList.remove('hidden');
    } else if (state === 'over') {
        finalScoreEl.textContent = score;
        let highScore = parseInt(localStorage.getItem('gyroBouncerHighScore')) || 0;
        if (score > highScore) {
            highScore = score;
            localStorage.setItem('gyroBouncerHighScore', highScore);
        }
        highScoreEl.textContent = highScore;
        gameOverScreen.classList.remove('hidden');
        resizeCanvas(); // Ensure replay canvas is sized correctly when shown
        replay.startPlayback(60); // Assuming 60fps, can be improved later
    }
}

function update(deltaTime) {
    const tilt = controls.getTilt();
    player.update(tilt, platformManager.platforms, canvas.width, deltaTime);

    // Camera follows player
    if (player.y < cameraY + canvas.height / 2.5) {
        cameraY = player.y - canvas.height / 2.5;
    }
    
    // Update score
    score = Math.max(score, Math.floor(-cameraY / 10));
    scoreEl.textContent = score;

    platformManager.update(cameraY);
    
    // Game over condition
    if (player.y > cameraY + canvas.height) {
        gameState = 'gameOver';
        uiState('over');
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(0, -cameraY);

    platformManager.draw(ctx);
    player.draw(ctx);

    ctx.restore();
}

function drawReplay(deltaTime) {
    const frame = replay.getPlaybackFrame(deltaTime);
    if (!frame) return;

    replayCtx.clearRect(0, 0, replayCanvas.width, replayCanvas.height);
    
    // Scale replay content to fit the replay canvas, maintaining aspect ratio
    const scale = replayCanvas.width / canvas.width;
    replayCtx.save();
    replayCtx.scale(scale, scale);

    replayCtx.translate(0, -frame.cameraY);

    // Draw platforms
    for (const p of frame.platforms) {
        replayCtx.drawImage(platformImg, p.x, p.y, p.width, p.height);
    }

    // Draw player
    replayCtx.drawImage(playerImg, frame.player.x, frame.player.y, player.width, player.height);

    replayCtx.restore();
}


function gameLoop(timestamp) {
    if (!lastTime) {
        lastTime = timestamp;
    }
    const deltaTime = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    const clampedDeltaTime = Math.min(deltaTime, 0.1);

    if (gameState === 'playing') {
        // Clamp deltaTime to avoid large jumps if tab is inactive for a while
        update(clampedDeltaTime);
        draw();
        // Don't record replay if the player has a custom avatar to avoid complexity.
        if (!playerAvatarLoaded) {
            replay.recordFrame(player, platformManager.platforms, cameraY, clampedDeltaTime);
        }
    } else if (gameState === 'gameOver' && replay.isPlaying) {
        drawReplay(clampedDeltaTime);
    }
    
    requestAnimationFrame(gameLoop);
}

async function initializeGame() {
    await room.initialize();
    
    // Subscribe to presence updates to ensure we have the user's data.
    const waitForOwnPresence = new Promise(resolve => {
        if (room.peers[room.clientId]) {
            resolve();
            return;
        }
        const unsubscribe = room.subscribePresence(() => {
            if (room.peers[room.clientId]) {
                unsubscribe();
                resolve();
            }
        });
    });

    await waitForOwnPresence;
    await loadPlayerAsset();
    init();
}

startButton.addEventListener('click', async () => {
    try {
        const granted = await controls.requestPermission();
        if (granted) {
            await initializeGame();
        } else {
            alert('Motion sensor access is required to play this game.');
        }
    } catch (error) {
        console.error("Error during startup:", error);
        alert('An error occurred while starting the game.');
    }
});

restartButton.addEventListener('click', () => {
    lastTime = 0; // Reset lastTime on restart
    init();
});

// Initial UI state
uiState('start');
requestAnimationFrame(gameLoop);