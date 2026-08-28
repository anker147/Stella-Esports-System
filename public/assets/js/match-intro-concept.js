const concept = {
  left: {
    name: '365DAYS',
    word: '365DAYS',
    logo: '/assets/teams/2026-07-26/pc/pc-365days-escape.png'
  },
  right: {
    name: '小姐姐的洋房',
    word: '洋房',
    logo: '/assets/teams/2026-07-26/pc/pc-xiaojiejiedeyangfang-hunter.png'
  }
};

const stage = document.querySelector('#stage');
const replay = document.querySelector('#replay');

function applyConcept() {
  document.querySelector('#leftName').textContent = concept.left.name;
  document.querySelector('#leftWord').textContent = concept.left.word;
  document.querySelector('#leftLogo').src = concept.left.logo;
  document.querySelector('#leftSoloName').textContent = concept.left.name;
  document.querySelector('#leftSoloWord').textContent = concept.left.name;
  document.querySelector('#leftSoloLogo').src = concept.left.logo;
  document.querySelector('#rightName').textContent = concept.right.name;
  document.querySelector('#rightWord').textContent = concept.right.word;
  document.querySelector('#rightLogo').src = concept.right.logo;
  document.querySelector('#rightSoloName').textContent = concept.right.name;
  document.querySelector('#rightSoloWord').textContent = concept.right.name;
  document.querySelector('#rightSoloLogo').src = concept.right.logo;
}

function play() {
  stage.classList.remove('playing');
  void stage.offsetWidth;
  stage.classList.add('playing');
}

if (new URLSearchParams(window.location.search).has('clean')) {
  document.body.classList.add('clean');
}

applyConcept();
replay.addEventListener('click', play);
window.addEventListener('load', play);
