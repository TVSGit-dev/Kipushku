/**
 * Le coffre : chiffre et déchiffre une sauvegarde avec un mot de passe, dans le navigateur (WebCrypto).
 * Le même code tourne dans l'appli Google (pour exporter vers Kipushku), dans Kipushku (sauvegarder, restaurer)
 * et dans les tests (node).
 *
 * AES-GCM 256 bits ; la clé vient du mot de passe par PBKDF2-SHA-256 (600 000 tours, sel aléatoire). Sans le
 * mot de passe, le fichier est illisible ; une seule lettre changée dans le fichier, et il est refusé.
 */
(function (racine) {
  'use strict';

  var FORMAT = 'kipushku-coffre', TOURS = 600000;
  function sub() {
    var c = racine.crypto || (typeof crypto !== 'undefined' ? crypto : null);
    if (!c || !c.subtle) throw new Error('Ce navigateur ne sait pas chiffrer.');
    return c;
  }
  function versB64(octets) {
    var s = '';
    for (var i = 0; i < octets.length; i++) s += String.fromCharCode(octets[i]);
    return btoa(s);
  }
  function deB64(texte) {
    var s = atob(texte), o = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
    return o;
  }
  function cle(motDePasse, sel, tours) {
    var c = sub();
    return c.subtle.importKey('raw', new TextEncoder().encode(motDePasse), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return c.subtle.deriveKey({ name: 'PBKDF2', salt: sel, iterations: tours, hash: 'SHA-256' }, base,
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }

  /** Le texte (JSON) chiffré : un texte JSON qu'on peut ranger dans un fichier ou copier-coller. */
  function chiffrer(texte, motDePasse) {
    if (!motDePasse || motDePasse.length < 8) return Promise.reject(new Error('Le mot de passe fait au moins 8 caractères.'));
    var c = sub(), sel = c.getRandomValues(new Uint8Array(16)), iv = c.getRandomValues(new Uint8Array(12));
    return cle(motDePasse, sel, TOURS).then(function (k) {
      return c.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(texte));
    }).then(function (chiffre) {
      return JSON.stringify({ format: FORMAT, version: 1, kdf: 'PBKDF2-SHA-256', tours: TOURS,
                              sel: versB64(sel), iv: versB64(iv), donnees: versB64(new Uint8Array(chiffre)) });
    });
  }

  /** Le texte d'origine ; une erreur claire si ce n'est pas un coffre, ou si le mot de passe est faux. */
  function dechiffrer(coffre, motDePasse) {
    var o;
    try { o = typeof coffre === 'string' ? JSON.parse(coffre.trim()) : coffre; } catch (e) { return Promise.reject(new Error('Ce n\'est pas une sauvegarde Kipushku.')); }
    if (!o || o.format !== FORMAT || !o.sel || !o.iv || !o.donnees) return Promise.reject(new Error('Ce n\'est pas une sauvegarde Kipushku.'));
    var tours = Number(o.tours) || TOURS;
    return cle(motDePasse || '', deB64(o.sel), tours).then(function (k) {
      // Seul un échec du déchiffrement veut dire « mauvais mot de passe » (AES-GCM vérifie aussi l'intégrité).
      return sub().subtle.decrypt({ name: 'AES-GCM', iv: deB64(o.iv) }, k, deB64(o.donnees)).then(null, function () {
        throw new Error('Mot de passe incorrect (ou fichier abîmé).');
      });
    }).then(function (clair) { return new TextDecoder().decode(clair); });
  }

  racine.COFFRE = { chiffrer: chiffrer, dechiffrer: dechiffrer, FORMAT: FORMAT };
})(typeof window !== 'undefined' ? window : globalThis);
