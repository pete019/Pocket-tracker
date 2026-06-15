const searchInput = document.getElementById('search');
const searchButton = document.getElementById('searchButton');
const smsBody = document.getElementById('smsBody');
const smsSender = document.getElementById('smsSender');
const parseButton = document.getElementById('parseButton');
const statusDiv = document.getElementById('status');
const resultsDiv = document.getElementById('results');

searchButton.addEventListener('click', () => {
  const query = searchInput.value.trim();
  if (!query) {
    updateStatus('Enter a search value first.');
    resultsDiv.innerHTML = '';
    return;
  }
  searchStudents(query);
});

parseButton.addEventListener('click', () => {
  const message = smsBody.value.trim();
  const sender = smsSender.value.trim();

  if (!message) {
    updateStatus('Paste an M-Pesa message before parsing.');
    resultsDiv.innerHTML = '';
    return;
  }

  parseSms(message, sender);
});

async function searchStudents(query) {
  updateStatus('Searching student records...');

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const json = await response.json();
    const rows = json.rows || [];
    renderResults(rows);
    updateStatus(`Search returned ${rows.length} result(s).`);
  } catch (error) {
    console.error('Search failed', error);
    updateStatus('Search failed. Check the server logs.');
  }
}

async function parseSms(message, sender) {
  updateStatus('Parsing SMS and looking up records...');

  try {
    const response = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sender }),
    });

    const json = await response.json();
    if (!response.ok) {
      updateStatus(json.error || 'Failed to parse SMS.');
      return;
    }

    renderParseResult(json);
    updateStatus(`Parsed SMS and found ${json.rows?.length || 0} match(es).`);
  } catch (error) {
    console.error('Parse failed', error);
    updateStatus('Failed to parse SMS. Check the server logs.');
  }
}

function renderParseResult(data) {
  const parsed = data.parsed || {};
  const rows = data.rows || [];
  const parsedHtml = `
    <div class="card parsed-card">
      <h3>Parsed SMS</h3>
      <p><strong>Sender name:</strong> ${escapeHtml(parsed.senderName || 'N/A')}</p>
      <p><strong>Phone:</strong> ${escapeHtml(parsed.phoneNumber || 'N/A')}</p>
      <p><strong>Amount:</strong> ${escapeHtml(parsed.amount || 'N/A')}</p>
      <p><strong>Transaction type:</strong> ${escapeHtml(parsed.transactionType || 'N/A')}</p>
      <p><strong>Message body:</strong> ${escapeHtml(parsed.body || '')}</p>
    </div>
  `;

  const rowsHtml = rows.length ? rows.map(renderRecordCard).join('') : '<p>No matching student records found.</p>';
  resultsDiv.innerHTML = parsedHtml + rowsHtml;
}

function renderResults(rows) {
  if (!rows || rows.length === 0) {
    resultsDiv.innerHTML = '<p>No matching student records found.</p>';
    return;
  }
  resultsDiv.innerHTML = rows.map(renderRecordCard).join('');
}

function renderRecordCard(record) {
  return `
    <div class="card">
      <h3>${escapeHtml(record.studentName || 'Unknown')}</h3>
      <p><strong>Admission:</strong> ${escapeHtml(record.admissionNo || 'N/A')}</p>
      <p><strong>Class:</strong> ${escapeHtml(record.className || 'N/A')}</p>
      <p><strong>Father:</strong> ${escapeHtml(record.fatherName || 'N/A')}</p>
      <p><strong>Mother:</strong> ${escapeHtml(record.motherName || 'N/A')}</p>
      <p><strong>Phone:</strong> ${escapeHtml(record.phone || 'N/A')}</p>
    </div>
  `;
}

function updateStatus(message) {
  statusDiv.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

