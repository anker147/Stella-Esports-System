const stage = document.querySelector('#bpStage');
const replay = document.querySelector('#replay');
const countdown = document.querySelector('#countdown');
const countdownTens = document.querySelector('#countdownTens');
const countdownOnes = document.querySelector('#countdownOnes');
let countdownTimer = null;
let countdownDelay = null;

const digitSource = digit => `/assets/match-intro/bp-countdown/${digit}.png`;

function renderCountdown(seconds) {
  const value = String(seconds).padStart(2, '0');
  countdownTens.src = digitSource(value[0]);
  countdownOnes.src = digitSource(value[1]);
  countdown.classList.toggle('narrow-tens', value[0] === '1');
  countdown.setAttribute('aria-label', value);
}

function play() {
  clearInterval(countdownTimer);
  clearTimeout(countdownDelay);
  renderCountdown(30);
  stage.classList.remove('playing');
  void stage.offsetWidth;
  stage.classList.add('playing');

  let seconds = 30;
  countdownDelay = setTimeout(() => {
    countdownTimer = setInterval(() => {
      seconds = Math.max(0, seconds - 1);
      renderCountdown(seconds);
      if (seconds === 0) clearInterval(countdownTimer);
    }, 1000);
  }, 1850);
}

for (let digit = 0; digit <= 9; digit += 1) {
  const image = new Image();
  image.src = digitSource(digit);
}

if (new URLSearchParams(window.location.search).has('clean')) {
  document.body.classList.add('clean');
}

replay.addEventListener('click', play);
window.addEventListener('load', play);
