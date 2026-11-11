// Généré depuis src/Code.gs par scripts/construire-pwa.js : ne pas modifier ici.
/**
 * ============================================================
 *  💶 RESTE À VIVRE — appli web personnelle
 *
 *  Le classeur est la base de données : un onglet par table, une ligne par
 *  élément, lisible et modifiable à la main depuis l'ordinateur.
 *  La page (Appli.html) fait tous les calculs (Calcul.html, testé hors ligne) :
 *  ici, on ne fait que lire, valider et écrire.
 *
 *  Les dates sont du texte « 2026-11-07 » (format texte sur la colonne) : ni
 *  heure ni fuseau. Les montants sont des nombres en euros.
 * ============================================================
 */

const TITRE = '💶 Reste à vivre';

/** Les tables : [clé, en-tête lisible]. L'ordre des colonnes est celui de la liste. */
const TABLES = {
  REGLAGES: { nom: '⚙️ Réglages', texte: ['cle'], cols: [['cle', 'Réglage'], ['valeur', 'Valeur'], ['aide', 'À quoi ça sert']] },
  POSTES: {
    nom: '📋 Postes', texte: ['id', 'note'],
    cols: [['id', 'id'], ['libelle', 'Libellé'], ['genre', 'Genre (fixe, epargne, favori, revenu)'], ['montant', 'Montant €'],
           ['frequence', 'Tous les … mois'], ['jour', 'Jour'], ['mois', 'Mois d\'échéance (non mensuel)'],
           ['recurrent', 'Récurrent (favori)'], ['fois', 'Fois par mois'], ['emoji', 'Emoji'], ['actif', 'Actif'], ['note', 'Note']],
  },
  DEPENSES: {
    nom: '🧾 Dépenses', texte: ['id', 'date'],
    cols: [['id', 'id'], ['date', 'Date'], ['libelle', 'Libellé'], ['montant', 'Montant €'], ['poste', 'Poste'], ['cree', 'Encodée (ms)'],
           ['sens', 'Sens (depense, revenu, transfert)']],
  },
  SOLDES: {
    nom: '🏦 Soldes', texte: ['id', 'date'],
    cols: [['id', 'id'], ['date', 'Date'], ['montant', 'Solde du compte €'], ['carte', 'Encours carte €'],
           ['salaireRecu', 'Salaire reçu'], ['cree', 'Encodé (ms)']],
  },
  STATUTS: {
    nom: '✔️ Statuts', texte: ['periode', 'poste'],
    cols: [['periode', 'Mois de budget'], ['poste', 'Poste'], ['statut', 'Statut (paye, attendu)']],
  },
};

/** La version des en-têtes : à augmenter quand une colonne s'ajoute, pour réécrire les en-têtes des onglets existants. */
const SCHEMA = '4';

const REGLAGES_AIDE = {
  jourPaie: 'Le jour où le salaire arrive : le mois de budget va de ce jour au suivant.',
  salaire: 'Le salaire net habituel (facultatif) : pour le plan du mois et la projection de l\'épargne.',
};

/* ---------------- la page ---------------- */

function doGet() {
  let donnees;
  try { donnees = donnees_(); } catch (e) { donnees = JSON.stringify({ erreur: String(e && e.message || e) }); }
  const t = HtmlService.createTemplateFromFile('Appli');
  // Dans un <script> : aucun « < » brut, ni séparateur de ligne Unicode, pour qu'un libellé ne ferme pas la balise.
  t.donnees = donnees.replace(/</g, '\\u003c')
    .split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');
  return t.evaluate()
    .setTitle(TITRE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable', 'yes')
    .addMetaTag('mobile-web-app-capable', 'yes');
}

/** Insère un autre fichier HTML du projet (le calcul) dans la page. */
function include(nom) {
  return HtmlService.createHtmlOutputFromFile(nom).getContent();
}

/** Tout l'état, en JSON : ce que la page dessine et calcule. */
function donnees_() {
  installer_();
  const reglages = {};
  lire_(TABLES.REGLAGES).forEach(function (r) { reglages[r.cle] = r.valeur; });
  return JSON.stringify({
    reglages: reglages,
    postes: lire_(TABLES.POSTES).map(function (p) {
      return { id: p.id, libelle: p.libelle, genre: p.genre, montant: nombre_(p.montant), frequence: nombre_(p.frequence) || 1,
               jour: nombre_(p.jour) || 1, mois: nombre_(p.mois) || 1, recurrent: oui_(p.recurrent), fois: nombre_(p.fois) || 1,
               emoji: p.emoji, actif: p.actif === '' ? true : oui_(p.actif), note: noteAJour_(p.note, nombre_(p.montant)) };
    }),
    depenses: lire_(TABLES.DEPENSES).map(function (d) {
      return { id: d.id, date: d.date, libelle: d.libelle, montant: nombre_(d.montant), poste: d.poste, cree: nombre_(d.cree),
               sens: SENS.indexOf(d.sens) >= 0 ? d.sens : 'depense' };
    }),
    soldes: lire_(TABLES.SOLDES).map(function (s) {
      return { id: s.id, date: s.date, montant: nombre_(s.montant), carte: nombre_(s.carte),
               salaireRecu: s.salaireRecu === '' ? null : oui_(s.salaireRecu), cree: nombre_(s.cree) };
    }),
    statuts: lire_(TABLES.STATUTS),
    aujourdhui: Utilities.formatDate(new Date(), 'Europe/Brussels', 'yyyy-MM-dd'),
  });
}

/** Appelée par la page pour se rafraîchir. */
function donnees() { return donnees_(); }

/* ---------------- les écritures (appelées par la page) ---------------- */
// Chacune valide ce qu'elle reçoit, écrit sous verrou, et rend l'état à jour.

function enregistrerSolde(s) {
  s = s || {};
  const ligne = {
    id: nouvelId_(), date: dateValide_(s.date), montant: montantValide_(s.montant, true),
    carte: s.carte === '' || s.carte == null ? 0 : Math.abs(montantValide_(s.carte, false)),
    salaireRecu: s.salaireRecu === true ? 'oui' : s.salaireRecu === false ? 'non' : '', cree: Date.now(),
  };
  return sousVerrou_(function () { ajouter_(TABLES.SOLDES, ligne); });
}

function supprimerSolde(id) {
  return sousVerrou_(function () { supprimer_(TABLES.SOLDES, String(id)); });
}

const SENS = ['depense', 'revenu', 'transfert'];

/**
 * Un mouvement : une dépense (par défaut), un revenu (un remboursement, arrivé ou prévu ; ou l'épargne rapatriée
 * pour une facture lissée, avec son poste) ou un transfert vers l'épargne (la part d'une facture lissée, avec son poste ;
 * ou un versement libre, sans poste).
 */
function enregistrerDepense(d) {
  const ligne = mouvementValide_(d);
  return sousVerrou_(function () { ajouter_(TABLES.DEPENSES, ligne); });
}

/** Plusieurs transferts vers l'épargne d'un coup (« Tout transférer »), sous un seul verrou. */
function enregistrerTransferts(liste) {
  if (!Array.isArray(liste) || !liste.length) throw new Error('Rien à transférer.');
  const lignes = liste.map(function (d) {
    const l = mouvementValide_(d);
    if (l.sens !== 'transfert') throw new Error('Seulement des transferts vers l\'épargne.');
    return l;
  });
  return sousVerrou_(function () { lignes.forEach(function (l) { ajouter_(TABLES.DEPENSES, l); }); });
}

function mouvementValide_(d) {
  d = d || {};
  const sens = SENS.indexOf(d.sens) >= 0 ? d.sens : 'depense';
  const ligne = {
    id: nouvelId_(), date: dateValide_(d.date), libelle: texteValide_(d.libelle, 'Libellé'),
    montant: Math.abs(montantValide_(d.montant, false)), poste: String(d.poste || '').slice(0, 40), cree: Date.now(),
    sens: sens,
  };
  if (!ligne.montant) throw new Error('Le montant doit être plus grand que 0.');
  return ligne;
}

function supprimerDepense(id) {
  return sousVerrou_(function () { supprimer_(TABLES.DEPENSES, String(id)); });
}

/** Plusieurs mouvements d'un coup (décocher un transfert : ceux du mois pour cette facture). */
function supprimerDepenses(ids) {
  if (!Array.isArray(ids)) throw new Error('Liste attendue.');
  return sousVerrou_(function () { ids.forEach(function (id) { supprimer_(TABLES.DEPENSES, String(id)); }); });
}

/** Force le statut d'une charge pour un mois de budget : 'paye', 'attendu', ou '' pour revenir à l'automatique. */
function changerStatut(periode, poste, statut) {
  periode = String(periode || '');
  poste = String(poste || '');
  if (!/^\d{4}-\d{2}$/.test(periode) || !poste) throw new Error('Mois ou poste inconnu.');
  if (['paye', 'attendu', ''].indexOf(statut) === -1) throw new Error('Statut inconnu.');
  return sousVerrou_(function () {
    const sh = feuille_(TABLES.STATUTS), lignes = lire_(TABLES.STATUTS);
    const i = lignes.findIndex(function (l) { return l.periode === periode && l.poste === poste; });
    if (i >= 0) sh.deleteRow(i + 2);
    if (statut) ajouter_(TABLES.STATUTS, { periode: periode, poste: poste, statut: statut });
  });
}

const GENRES = ['fixe', 'epargne', 'favori', 'revenu'];

function enregistrerPoste(p) {
  p = p || {};
  if (GENRES.indexOf(p.genre) === -1) throw new Error('Genre inconnu.');
  const frequence = [1, 2, 3, 4, 6, 12].indexOf(Number(p.frequence)) >= 0 ? Number(p.frequence) : 1;
  const montant = Math.abs(montantValide_(p.montant, false));
  const ligne = {
    id: p.id ? String(p.id) : nouvelId_(),
    libelle: texteValide_(p.libelle, 'Libellé'), genre: p.genre,
    montant: montant,
    frequence: p.genre === 'favori' ? 1 : frequence,
    jour: entierValide_(p.jour, 1, 31, 'Jour'),
    mois: frequence > 1 ? entierValide_(p.mois, 1, 12, 'Mois d\'échéance') : 1,
    recurrent: p.genre === 'favori' && p.recurrent === true ? 'oui' : 'non',
    fois: p.genre === 'favori' && p.recurrent === true ? entierValide_(p.fois, 1, 31, 'Fois par mois') : 1,
    emoji: String(p.emoji || '').slice(0, 4), actif: p.actif === false ? 'non' : 'oui',
    note: noteAJour_(String(p.note || '').slice(0, 120), montant),
  };
  return sousVerrou_(function () {
    if (p.id && trouver_(TABLES.POSTES, ligne.id) > 0) remplacer_(TABLES.POSTES, ligne.id, ligne);
    else ajouter_(TABLES.POSTES, ligne);
  });
}

function supprimerPoste(id) {
  return sousVerrou_(function () { supprimer_(TABLES.POSTES, String(id)); });
}

function enregistrerReglages(r) {
  r = r || {};
  const valeurs = {
    jourPaie: entierValide_(r.jourPaie, 1, 31, 'Jour de paie'),
    salaire: r.salaire === '' || r.salaire == null ? '' : Math.abs(montantValide_(r.salaire, false)),
  };
  return sousVerrou_(function () {
    Object.keys(valeurs).forEach(function (cle) {
      const ligne = { cle: cle, valeur: valeurs[cle], aide: REGLAGES_AIDE[cle] || '' };
      if (trouver_(TABLES.REGLAGES, cle) > 0) remplacer_(TABLES.REGLAGES, cle, ligne);
      else ajouter_(TABLES.REGLAGES, ligne);
    });
  });
}

/* ---------------- sauvegarde : exporter, restaurer ---------------- */

const FORMAT_EXPORT = 'kipushku-export';

/** Tout le classeur, onglet par onglet (en-têtes compris), en JSON : à chiffrer dans la page, puis à ranger. */
function exporter() {
  installer_();
  const feuilles = {};
  Object.keys(TABLES).forEach(function (k) {
    const t = TABLES[k], sh = feuille_(t), n = sh.getLastRow();
    feuilles[k] = n ? sh.getRange(1, 1, n, t.cols.length).getValues().map(function (l) {
      return l.map(function (v) { return v instanceof Date ? Utilities.formatDate(v, 'Europe/Brussels', 'yyyy-MM-dd') : v; });
    }) : [];
  });
  return JSON.stringify({ format: FORMAT_EXPORT, version: 1, schema: SCHEMA, exporte: Date.now(), feuilles: feuilles });
}

/** Remplace tout le classeur par une sauvegarde (le texte d'exporter). Rend l'état à jour. */
function restaurer(texte) {
  let s;
  try { s = JSON.parse(String(texte || '')); } catch (e) { throw new Error('Sauvegarde illisible.'); }
  if (!s || s.format !== FORMAT_EXPORT || !s.feuilles) throw new Error('Ce n\'est pas une sauvegarde Kipushku.');
  // Tout est vérifié avant d'écrire : une sauvegarde abîmée ne vide pas le classeur à moitié.
  const lignes = {};
  Object.keys(TABLES).forEach(function (k) {
    const t = TABLES[k], v = s.feuilles[k] || [];
    if (!Array.isArray(v) || v.some(function (l) { return !Array.isArray(l); })) throw new Error('Sauvegarde abîmée (' + t.nom + ').');
    // Sans l'en-tête ; chaque ligne à la largeur de la table (une colonne ajoutée depuis : vide).
    lignes[k] = v.slice(1).filter(function (l) { return String(l[0] == null ? '' : l[0]).trim() !== ''; }).map(function (l) {
      return t.cols.map(function (c, i) { return l[i] === undefined || l[i] === null ? '' : l[i]; });
    });
  });
  return sousVerrou_(function () {
    Object.keys(TABLES).forEach(function (k) {
      const t = TABLES[k], sh = feuille_(t);
      sh.clearContents();
      sh.getRange(1, 1, 1, t.cols.length).setValues([t.cols.map(function (c) { return c[1]; })]).setFontWeight('bold');
      if (lignes[k].length) sh.getRange(2, 1, lignes[k].length, t.cols.length).setValues(lignes[k]);
    });
    // Les postes viennent de la sauvegarde : pas de graines par-dessus.
    PropertiesService.getScriptProperties().setProperty('graines', 'posees');
  });
}

/* ---------------- validation ---------------- */

function dateValide_(s) {
  s = String(s || '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('Date illisible.');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new Error('Cette date n\'existe pas.');
  return s;
}
function montantValide_(x, signeAutorise) {
  const n = typeof x === 'number' ? x : Number(String(x == null ? '' : x).replace(/[\s€]/g, '').replace(',', '.'));
  if (!isFinite(n) || String(x).trim() === '') throw new Error('Montant illisible.');
  if (!signeAutorise && n < 0) throw new Error('Montant négatif.');
  if (Math.abs(n) > 10000000) throw new Error('Montant trop grand.');
  return Math.round(n * 100) / 100;
}
function entierValide_(x, min, max, quoi) {
  const n = Number(x);
  if (!isFinite(n) || Math.round(n) !== n || n < min || n > max) throw new Error(quoi + ' : entre ' + min + ' et ' + max + '.');
  return n;
}
function texteValide_(s, quoi) {
  s = String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
  if (!s) throw new Error(quoi + ' vide.');
  return s.slice(0, 80);
}

/* ---------------- les tables ---------------- */

function sousVerrou_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Une autre écriture est en cours : réessaie dans un instant.');
  try { fn(); } finally { lock.releaseLock(); }
  return donnees_();
}

function classeur_() { return SpreadsheetApp.getActiveSpreadsheet(); }

/** L'onglet d'une table, créé (en-têtes, colonnes texte) s'il manque. */
function feuille_(t) {
  const ss = classeur_();
  let sh = ss.getSheetByName(t.nom);
  if (!sh) {
    sh = ss.insertSheet(t.nom);
    sh.getRange(1, 1, 1, t.cols.length).setValues([t.cols.map(function (c) { return c[1]; })]).setFontWeight('bold');
    sh.setFrozenRows(1);
    t.cols.forEach(function (c, i) {
      if ((t.texte || []).indexOf(c[0]) >= 0) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
  }
  return sh;
}

function lire_(t) {
  const sh = feuille_(t), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, t.cols.length).getValues()
    .filter(function (l) { return String(l[0]).trim() !== ''; })
    .map(function (l) {
      const o = {};
      t.cols.forEach(function (c, i) {
        let v = l[i];
        if (v instanceof Date) v = Utilities.formatDate(v, 'Europe/Brussels', 'yyyy-MM-dd');   // une date retapée à la main
        o[c[0]] = typeof v === 'string' ? v.trim() : v;
      });
      return o;
    });
}

function ajouter_(t, o) {
  feuille_(t).appendRow(t.cols.map(function (c) { return o[c[0]] === undefined ? '' : o[c[0]]; }));
}
/** La ligne (2 = la première) dont la première colonne vaut id, ou 0. */
function trouver_(t, id) {
  const sh = feuille_(t), n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const ids = sh.getRange(2, 1, n, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === String(id)) return i + 2;
  return 0;
}
function remplacer_(t, id, o) {
  const r = trouver_(t, id);
  if (!r) throw new Error('Élément introuvable : il a peut-être été supprimé entre-temps.');
  feuille_(t).getRange(r, 1, 1, t.cols.length).setValues([t.cols.map(function (c) { return o[c[0]] === undefined ? '' : o[c[0]]; })]);
}
function supprimer_(t, id) {
  const r = trouver_(t, id);
  if (r) feuille_(t).deleteRow(r);
}

function nouvelId_() { return Utilities.getUuid().slice(0, 8); }
function nombre_(v) {
  if (typeof v === 'number') return v;
  const n = Number(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
}
/** Une note de départ « ⚠️ … à compléter » n'a plus lieu d'être une fois le montant réglé. */
function noteAJour_(note, montant) {
  note = String(note == null ? '' : note);
  return montant > 0 && /^\s*⚠️/.test(note) ? '' : note;
}
function oui_(v) { return v === true || /^(oui|true|vrai|1|x)$/i.test(String(v).trim()); }

/* ---------------- installation ---------------- */

/** Crée les onglets qui manquent, et pose les postes de départ une seule fois. */
function installer_() {
  Object.keys(TABLES).forEach(function (k) { feuille_(TABLES[k]); });
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('schema') !== SCHEMA) {
    // Une colonne ajoutée depuis la création d'un onglet : son en-tête (les données se lisent par position).
    Object.keys(TABLES).forEach(function (k) {
      const t = TABLES[k];
      feuille_(t).getRange(1, 1, 1, t.cols.length).setValues([t.cols.map(function (c) { return c[1]; })]).setFontWeight('bold');
    });
    props.setProperty('schema', SCHEMA);
  }
  if (props.getProperty('graines') === 'posees') return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    if (props.getProperty('graines') === 'posees') return;
    if (!lire_(TABLES.POSTES).length) {
      const g = graines_();
      const sh = feuille_(TABLES.POSTES);
      const lignes = g.postes.map(function (p) {
        p.id = nouvelId_();
        return TABLES.POSTES.cols.map(function (c) { return p[c[0]] === undefined ? '' : p[c[0]]; });
      });
      if (lignes.length) sh.getRange(2, 1, lignes.length, TABLES.POSTES.cols.length).setValues(lignes);
      Object.keys(g.reglages).forEach(function (cle) {
        if (!trouver_(TABLES.REGLAGES, cle)) ajouter_(TABLES.REGLAGES, { cle: cle, valeur: g.reglages[cle], aide: REGLAGES_AIDE[cle] || '' });
      });
    }
    props.setProperty('graines', 'posees');
    // Le premier onglet de la feuille vide créée avec le classeur ne sert à rien.
    const vide = classeur_().getSheetByName('Feuille 1') || classeur_().getSheetByName('Sheet1');
    if (vide && vide.getLastRow() === 0 && classeur_().getSheets().length > 1) classeur_().deleteSheet(vide);
  } finally {
    lock.releaseLock();
  }
}

/** Kipushku : aucun poste de départ (ils viennent d'une sauvegarde, ou se créent dans les réglages). */
function graines_() { return { reglages: { jourPaie: 28, salaire: '' }, postes: [] }; }
