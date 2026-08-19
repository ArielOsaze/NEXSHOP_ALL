const fs = require('fs');
const lines = fs.readFileSync('nexshop-frontend/script.js', 'utf8').split('\n');

const part1 = lines.slice(0, 4312).join('\n');
const part2 = `                        heroAudioPlayer.play().catch(err => {
                            console.error("Audio play failed:", err);
                        });
                        isPlaying = true;
                        if (musicPlayIcon) {
                            musicPlayIcon.classList.remove("fa-play", "ml-1");
                            musicPlayIcon.classList.add("fa-pause");
                        }
                        if (musicDisc) musicDisc.classList.add("animate-spin-slow");
                    }
                });
            }
        }
    } catch (e) {
        console.error("Music init error:", e);
    }
}`;

const part3 = '\n' + lines.slice(4524, 4766).join('\n');

fs.writeFileSync('nexshop-frontend/script.js', part1 + '\n' + part2 + part3 + '\n');
console.log('Fixed script.js successfully');
