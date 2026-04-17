class MusicPlayer {
    constructor() {
        this.audio = new Audio();
        this.currentTrack = null;
        this.isPlaying = false;
        this.currentStyle = 'afrohouse';
        this.tracks = {
            afrohouse: [
                { title: 'Afro Groove', artist: 'DJ Afro', file: 'afro-groove.mp3' },
                { title: 'African Beats', artist: 'Rhythm Master', file: 'african-beats.mp3' },
                { title: 'Tribal House', artist: 'Afro Tribe', file: 'tribal-house.mp3' }
            ],
            frenchhouse: [
                { title: 'French Touch', artist: 'DJ French', file: 'french-touch.mp3' },
                { title: 'Paris House', artist: 'Electro Paris', file: 'paris-house.mp3' },
                { title: 'Disco French', artist: 'French Disco', file: 'disco-french.mp3' }
            ],
            tropicalhouse: [
                { title: 'Tropical Paradise', artist: 'Island Vibes', file: 'tropical-paradise.mp3' },
                { title: 'Beach House', artist: 'Tropical DJ', file: 'beach-house.mp3' },
                { title: 'Summer Breeze', artist: 'Island Grooves', file: 'summer-breeze.mp3' }
            ]
        };

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadTracks();
        this.updateStyle('afrohouse');
    }

    setupEventListeners() {
        document.getElementById('playPause').addEventListener('click', () => this.togglePlayPause());
        document.getElementById('stop').addEventListener('click', () => this.stop());
        document.getElementById('volume').addEventListener('input', (e) => this.setVolume(e.target.value));
        document.getElementById('musicStyle').addEventListener('change', (e) => this.updateStyle(e.target.value));

        this.audio.addEventListener('ended', () => this.nextTrack());
    }

    loadTracks() {
        const library = document.getElementById('library');
        library.innerHTML = '';

        this.tracks[this.currentStyle].forEach((track, index) => {
            const trackCard = document.createElement('div');
            trackCard.className = 'track-card';
            trackCard.innerHTML = `
                <h3>${track.title}</h3>
                <p>${track.artist}</p>
                <button class="play-track" data-index="${index}">Play</button>
            `;
            trackCard.querySelector('.play-track').addEventListener('click', () => this.playTrack(index));
            library.appendChild(trackCard);
        });
    }

    updateStyle(style) {
        this.currentStyle = style;
        this.loadTracks();
        document.getElementById('currentStyle').textContent = `Style: ${style.charAt(0).toUpperCase() + style.slice(1)}`;
        this.stop();
    }

    playTrack(index) {
        this.currentTrack = index;
        this.audio.src = `music/${this.tracks[this.currentStyle][index].file}`;
        this.audio.play();
        this.isPlaying = true;
        this.updatePlayPauseButton();
        this.updateCurrentTrackInfo();
    }

    togglePlayPause() {
        if (this.isPlaying) {
            this.audio.pause();
            this.isPlaying = false;
        } else {
            if (this.currentTrack !== null) {
                this.audio.play();
                this.isPlaying = true;
            } else {
                this.playTrack(0);
            }
        }
        this.updatePlayPauseButton();
    }

    stop() {
        this.audio.pause();
        this.audio.currentTime = 0;
        this.isPlaying = false;
        this.updatePlayPauseButton();
    }

    nextTrack() {
        if (this.currentTrack !== null) {
            const nextIndex = (this.currentTrack + 1) % this.tracks[this.currentStyle].length;
            this.playTrack(nextIndex);
        }
    }

    setVolume(volume) {
        this.audio.volume = volume / 100;
        document.getElementById('volumeValue').textContent = volume;
    }

    updatePlayPauseButton() {
        const playPauseBtn = document.getElementById('playPause');
        playPauseBtn.textContent = this.isPlaying ? 'Pause' : 'Play';
    }

    updateCurrentTrackInfo() {
        if (this.currentTrack !== null) {
            const track = this.tracks[this.currentStyle][this.currentTrack];
            document.getElementById('currentTrack').textContent = `${track.title} - ${track.artist}`;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new MusicPlayer();
});