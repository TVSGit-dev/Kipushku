/**
 * Kipushku sans Google : le « serveur » (Code.gs) tourne dans le téléphone, sur un classeur gardé dans le
 * navigateur (localStorage). Ce fichier fournit à Code.gs ce que Google lui donnerait (SpreadsheetApp,
 * PropertiesService, LockService, Utilities) et à la page son google.script.run. Rien ne quitte le téléphone.
 *
 * Le classeur est enregistré après chaque appel de la page ; il se lit d'un coup au démarrage.
 */
(function (racine) {
  'use strict';

  var CLE = 'kipushku.classeur';
  racine.MODE_LOCAL = true;

  /* ---------- le classeur, en mémoire puis dans le navigateur ---------- */

  function lireStockage() {
    try { var t = racine.localStorage.getItem(CLE); return t ? JSON.parse(t) : null; } catch (e) { return null; }
  }
  var etat = lireStockage() || { feuilles: [], proprietes: {} };   // feuilles : [{ nom, lignes: [[…]] }]

  function enregistrer() {
    try { racine.localStorage.setItem(CLE, JSON.stringify(etat)); }
    catch (e) { throw new Error('Le téléphone refuse d\'enregistrer (stockage plein ?) : ' + (e && e.message || e)); }
  }

  function Feuille(f) { this.f = f; }
  Feuille.prototype = {
    getLastRow: function () { var l = this.f.lignes; while (l.length && l[l.length - 1].every(vide)) l.pop(); return l.length; },
    getMaxRows: function () { return Math.max(1000, this.f.lignes.length); },
    setFrozenRows: function () {},
    clearContents: function () { this.f.lignes = []; return this; },
    appendRow: function (l) { this.getLastRow(); this.f.lignes.push(l.slice()); return this; },
    deleteRow: function (r) { this.f.lignes.splice(r - 1, 1); return this; },
    getRange: function (r, c, nr, nc) {
      var f = this.f;
      nr = nr || 1; nc = nc || 1;
      var plage = {
        getValues: function () {
          var out = [];
          for (var i = 0; i < nr; i++) {
            var l = f.lignes[r - 1 + i] || [], o = [];
            for (var j = 0; j < nc; j++) o.push(l[c - 1 + j] === undefined || l[c - 1 + j] === null ? '' : l[c - 1 + j]);
            out.push(o);
          }
          return out;
        },
        setValues: function (v) {
          if (v.length !== nr || v.some(function (l) { return l.length !== nc; })) throw new Error('Plage : dimensions incorrectes.');
          v.forEach(function (l, i) {
            while (f.lignes.length < r + i) f.lignes.push([]);
            var ligne = f.lignes[r - 1 + i];
            l.forEach(function (x, j) { ligne[c - 1 + j] = x; });
          });
          return plage;
        },
        setFontWeight: function () { return plage; },
        setNumberFormat: function () { return plage; },
      };
      return plage;
    },
  };
  function vide(x) { return x === '' || x === null || x === undefined; }

  var classeur = {
    getSheetByName: function (n) { var f = etat.feuilles.filter(function (x) { return x.nom === n; })[0]; return f ? new Feuille(f) : null; },
    insertSheet: function (n) { var f = { nom: n, lignes: [] }; etat.feuilles.push(f); return new Feuille(f); },
    getSheets: function () { return etat.feuilles.map(function (f) { return new Feuille(f); }); },
    deleteSheet: function (s) { etat.feuilles = etat.feuilles.filter(function (f) { return f !== s.f; }); },
  };

  /* ---------- ce que Google fournirait à Code.gs ---------- */

  racine.SpreadsheetApp = { getActiveSpreadsheet: function () { return classeur; } };
  racine.PropertiesService = { getScriptProperties: function () { return {
    getProperty: function (k) { return etat.proprietes[k] === undefined ? null : etat.proprietes[k]; },
    setProperty: function (k, v) { etat.proprietes[k] = String(v); },
  }; } };
  // Une seule page, un appel à la fois : le verrou est toujours libre.
  racine.LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } };
  racine.Utilities = {
    getUuid: function () {
      if (racine.crypto && racine.crypto.randomUUID) return racine.crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); });
    },
    /** Seul format employé par Code.gs : yyyy-MM-dd, à l'heure de Bruxelles. */
    formatDate: function (d, tz) {
      var p = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
      var v = {}; p.forEach(function (x) { v[x.type] = x.value; });
      return v.year + '-' + v.month + '-' + v.day;
    },
  };

  /* ---------- google.script.run, local ---------- */

  /** Chaque appel de la page : la fonction de Code.gs, puis le classeur enregistré ; la réponse arrive un instant après, comme chez Google. */
  function runner() {
    var succes = function () {}, echec = function () {};
    var r = {
      withSuccessHandler: function (f) { succes = f; return r; },
      withFailureHandler: function (f) { echec = f; return r; },
    };
    ['donnees', 'enregistrerSolde', 'supprimerSolde', 'enregistrerDepense', 'enregistrerTransferts', 'supprimerDepense', 'supprimerDepenses',
     'changerStatut', 'enregistrerPoste', 'supprimerPoste', 'enregistrerReglages', 'exporter', 'restaurer'].forEach(function (nom) {
      r[nom] = function () {
        var args = Array.prototype.slice.call(arguments);
        setTimeout(function () {
          var rendu;
          try { rendu = racine[nom].apply(null, args); enregistrer(); }
          catch (e) { etat = lireStockage() || { feuilles: [], proprietes: {} }; echec(e); return; }   // rien d'écrit à moitié
          succes(rendu);
        }, 0);
      };
    });
    return r;
  }
  racine.google = { script: { get run() { return runner(); } } };

  /** L'état de départ de la page, lu tout de suite (la page en a besoin pour se dessiner). */
  racine.donneesLocales = function () {
    var d = racine.donnees_();
    enregistrer();
    return JSON.parse(d);
  };

  // Demander au téléphone de ne jamais effacer ces données pour faire de la place.
  if (racine.navigator && racine.navigator.storage && racine.navigator.storage.persist) {
    racine.navigator.storage.persist().catch(function () {});
  }
})(typeof window !== 'undefined' ? window : globalThis);
