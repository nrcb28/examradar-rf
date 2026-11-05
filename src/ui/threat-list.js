/** Advertised device names and classifier reasons are untrusted text. */
export function renderThreats(container, threats) {
  const document = container.ownerDocument;
  const fragment = document.createDocumentFragment();
  if (threats.length === 0) {
    const message = document.createElement('p');
    message.textContent = 'No hay transmisiones sospechosas recientes.';
    fragment.append(message);
  }
  for (const threat of threats) {
    const card = document.createElement('div');
    card.className = threat.classification.category.score >= 90 ? 'threat-card critical' : 'threat-card';
    const title = document.createElement('div');
    title.className = 'threat-title';
    const name = document.createElement('span');
    name.textContent = threat.name;
    const distance = document.createElement('span');
    distance.className = 'threat-dist';
    distance.textContent = `${threat.distanceMeters.toFixed(2)} m`;
    title.append(name, distance);
    const detail = document.createElement('div');
    detail.className = 'threat-detail';
    detail.textContent = `${threat.classification.reason} • RSSI: ${threat.rssiFiltered} dBm`;
    card.append(title, detail);
    fragment.append(card);
  }
  container.replaceChildren(fragment);
}
