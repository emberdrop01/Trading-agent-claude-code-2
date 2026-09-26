import sodium from 'libsodium-wrappers';

const GITHUB_API = 'https://api.github.com';

async function ghRequest(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`GitHub API ${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

/**
 * Encrypts and writes a repository Actions secret via GitHub's API. Requires
 * a token (fine-grained PAT or classic PAT) with "Secrets: write" permission
 * on this repo. Uses libsodium's crypto_box_seal, exactly as GitHub's own
 * docs specify - https://docs.github.com/en/rest/actions/secrets
 */
export async function setRepoSecret({ owner, repo, token, name, value }) {
  await sodium.ready;
  const pk = await ghRequest(`/repos/${owner}/${repo}/actions/secrets/public-key`, { token });
  const messageBytes = sodium.from_string(value);
  const keyBytes = sodium.from_base64(pk.key, sodium.base64_variants.ORIGINAL);
  const encryptedBytes = sodium.crypto_box_seal(messageBytes, keyBytes);
  const encrypted_value = sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);

  await ghRequest(`/repos/${owner}/${repo}/actions/secrets/${name}`, {
    method: 'PUT',
    token,
    body: { encrypted_value, key_id: pk.key_id },
  });
}

/**
 * Writes a repository Actions VARIABLE (plaintext, not a secret - use for
 * non-sensitive config like SYMBOLS or CANDLE_GRANULARITY_SECONDS). Tries
 * PATCH (update) first; if the variable doesn't exist yet, creates it.
 */
export async function setRepoVariable({ owner, repo, token, name, value }) {
  try {
    await ghRequest(`/repos/${owner}/${repo}/actions/variables/${name}`, {
      method: 'PATCH',
      token,
      body: { name, value },
    });
  } catch (err) {
    if (err.status === 404) {
      await ghRequest(`/repos/${owner}/${repo}/actions/variables`, {
        method: 'POST',
        token,
        body: { name, value },
      });
    } else {
      throw err;
    }
  }
}
