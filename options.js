const tokenInput = document.getElementById('tokenInput');
const saveBtn    = document.getElementById('saveBtn');
const saveStatus = document.getElementById('saveStatus');

chrome.storage.sync.get('token', ({ token }) => {
  if (token) tokenInput.value = token;
});

saveBtn.addEventListener('click', () => {
  const value = tokenInput.value.trim();
  chrome.storage.sync.set({ token: value }, () => {
    saveStatus.classList.add('visible');
    setTimeout(() => saveStatus.classList.remove('visible'), 2000);
  });
});

tokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveBtn.click();
});
