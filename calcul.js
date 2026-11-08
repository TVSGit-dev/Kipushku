/**
 * Le calcul du reste à vivre, sans rien lire ni écrire : il reçoit l'état (réglages, postes, dépenses, soldes,
 * statuts) et la date du jour, il rend les chiffres. Le même code tourne dans la page et dans les tests (node).
 *
 * Les montants sont en centimes (des entiers), les dates en texte ISO « 2026-11-07 » : pas d'heure, pas de
 * fuseau, et deux dates se comparent comme deux textes.
 *
 * Le mois de budget va d'un jour de paie au suivant (exclu). Le reste à vivre, c'est ce qu'on peut dépenser
 * en variables d'ici la prochaine paie :
 *   solde net (le solde du compte moins l'encours de la carte de crédit : dépensé, pas encore prélevé)
 *   + salaire attendu (paie en retard : solde encodé après le jour de paie, salaire pas encore arrivé)
 *   + revenus fixes de ce mois pas encore reçus (une allocation, un loyer perçu, une prime annuelle…)
 *   − charges fixes et épargne de ce mois pas encore débitées
 *   − réserve des charges lissées (une assurance annuelle de 600 € met 50 € de côté par mois), moins ce qui en a
 *     déjà été transféré sur l'épargne
 *   + ce qui est à rapatrier de l'épargne le mois de l'échéance d'une charge lissée
 *   − dépenses récurrentes prévues ce mois et pas encore faites (2 cours de sport prévus, 1 fait : 1 réservé)
 *   − dépenses encodées après le solde (pas encore dedans)
 *   + revenus encodés après le solde (un remboursement arrivé, ou prévu à une date : pas encore dedans)
 */
(function (racine) {
  'use strict';

  var JOUR_MS = 864e5;

  function deuxChiffres(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + deuxChiffres(m) + '-' + deuxChiffres(d); }
  function lireIso(s) { var p = String(s).split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
  /** Le numéro du jour : pour compter les jours entre deux dates. */
  function numJour(s) { var p = lireIso(s); return Date.UTC(p.y, p.m - 1, p.d) / JOUR_MS; }
  function joursDansMois(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  /** Le jour j du mois, ramené au dernier jour s'il n'existe pas (un 31 en février : le 28 ou le 29). */
  function borne(y, m, j) { return Math.min(j, joursDansMois(y, m)); }
  function centimes(x) {
    var n = typeof x === 'number' ? x : Number(String(x == null ? '' : x).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? Math.round(n * 100) : 0;
  }
  function estActif(p) { return p.actif !== false && p.actif !== 'non' && p.actif !== 'FALSE'; }
  /** Un mouvement encodé : une dépense (par défaut) ou un revenu (un remboursement…). */
  function estRevenu(x) { return x.sens === 'revenu'; }
  /** Un transfert vers l'épargne, pour une facture lissée : il sort du compte comme une dépense. */
  function estTransfert(x) { return x.sens === 'transfert'; }
  function estRecurrent(p) { return p.recurrent === true || p.recurrent === 'oui' || p.recurrent === 'TRUE'; }

  /* ---------------- les mois de budget ---------------- */

  /** Le mois de budget qui commence le jour de paie du mois (y, m). */
  function periodeDuMois(y, m, jourPaie) {
    var s = m === 12 ? { y: y + 1, m: 1 } : { y: y, m: m + 1 };
    return {
      cle: iso(y, m, 1).slice(0, 7), index: y * 12 + m - 1, y: y, m: m,
      debut: iso(y, m, borne(y, m, jourPaie)), fin: iso(s.y, s.m, borne(s.y, s.m, jourPaie)),
    };
  }
  function periodeDecalee(per, n, jourPaie) {
    var i = per.index + n;
    return periodeDuMois(Math.floor(i / 12), (i % 12) + 1, jourPaie);
  }
  /** Le mois de budget d'une date : celui du dernier jour de paie passé (ou du jour même). */
  function periodeDe(dateIso, jourPaie) {
    var p = lireIso(dateIso);
    var per = periodeDuMois(p.y, p.m, jourPaie);
    return dateIso < per.debut ? periodeDecalee(per, -1, jourPaie) : per;
  }
  /**
   * Le mois de budget d'un solde. Un salaire arrivé avant le jour de paie (un vendredi, avant un week-end) ouvre
   * déjà le mois suivant : le solde le contient, il appartient à ce mois-là.
   */
  function periodeDuSolde(s, jourPaie) {
    var per = periodeDe(s.date, jourPaie);
    if (s.salaireRecu === true && numJour(per.fin) - numJour(s.date) <= 7) return periodeDecalee(per, 1, jourPaie);
    return per;
  }
  /** Le salaire pas encore arrivé alors que le jour de paie est passé (paie en retard) : à ajouter au solde. */
  function salaireAttendu(s, per, salaire) {
    if (!s || s.salaireRecu !== false || !salaire) return 0;
    return numJour(s.date) - numJour(per.debut) <= 7 ? salaire : 0;
  }

  /**
   * La date à laquelle un poste fixe tombe dans ce mois de budget, ou null. Un poste non mensuel (fréquence 3, 6,
   * 12 mois) tombe les mois « mois de référence + n × fréquence ».
   */
  function occurrence(poste, per) {
    var k = Number(poste.frequence) || 1, jour = Number(poste.jour) || 1, m0 = Number(poste.mois) || 1;
    var cands = [{ y: per.y, m: per.m }, per.m === 12 ? { y: per.y + 1, m: 1 } : { y: per.y, m: per.m + 1 }];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i], d = iso(c.y, c.m, borne(c.y, c.m, jour));
      if (d < per.debut || d >= per.fin) continue;
      if (k > 1 && (((c.m - m0) % k) + k) % k !== 0) continue;
      return d;   // la première seulement : un jour ramené en fin de mois ne compte pas deux fois
    }
    return null;
  }
  function prochaineOccurrence(poste, per, jourPaie) {
    var k = Number(poste.frequence) || 1;
    for (var i = 1; i <= k + 1; i++) {
      var d = occurrence(poste, periodeDecalee(per, i, jourPaie));
      if (d) return d;
    }
    return null;
  }

  function parDate(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (Number(a.cree) || 0) - (Number(b.cree) || 0);
  }
  /**
   * Le solde net : le compte moins l'encours de la carte de crédit. La carte est prélevée en une fois par mois :
   * ses achats sont déjà dépensés mais pas encore sortis du compte. Le prélèvement ne change pas le net
   * (le solde baisse, l'encours aussi).
   */
  function net(s) { return centimes(s.montant) - Math.abs(centimes(s.carte)); }
  /** Une dépense encodée après le solde n'y est pas encore (même jour : créée après lui). */
  function apresSolde(dep, s) {
    if (!s) return true;
    return dep.date > s.date || (dep.date === s.date && (Number(dep.cree) || 0) > (Number(s.cree) || 0));
  }

  /* ---------------- le plan d'un mois type ---------------- */

  function planDuMois(postes, salaire) {
    var plan = { salaire: salaire, revenus: 0, fixes: 0, lissees: 0, recurrentes: 0, epargne: 0, enveloppe: null };
    postes.forEach(function (p) {
      var a = centimes(p.montant), k = Number(p.frequence) || 1;
      if (p.genre === 'revenu') plan.revenus += Math.round(a / k);
      else if (p.genre === 'epargne') plan.epargne += Math.round(a / k);
      else if (p.genre === 'fixe') { if (k > 1) plan.lissees += Math.round(a / k); else plan.fixes += a; }
      else if (p.genre === 'favori' && estRecurrent(p)) plan.recurrentes += a * (Number(p.fois) || 1);
    });
    if (salaire) plan.enveloppe = salaire + plan.revenus - plan.fixes - plan.lissees - plan.recurrentes - plan.epargne;
    return plan;
  }

  /* ---------------- le calcul ---------------- */

  function calculer(etat, aujourdhui) {
    var reglages = etat.reglages || {};
    var J = Math.round(Number(reglages.jourPaie)) || 0;
    var postes = (etat.postes || []).filter(estActif);
    var salaire = centimes(reglages.salaire) || 0;
    var plan = planDuMois(postes, salaire);
    if (J < 1 || J > 31) return { aConfigurer: true, plan: plan };

    var soldes = (etat.soldes || []).slice().sort(parDate);
    var perAuj = periodeDe(aujourdhui, J);
    var dernier = soldes[soldes.length - 1] || null;
    var perSolde = dernier ? periodeDuSolde(dernier, J) : null;
    var per = perSolde && perSolde.index > perAuj.index ? perSolde : perAuj;
    var aJour = !!perSolde && perSolde.index === per.index;
    var solde = aJour ? dernier : null;

    var statuts = {};
    (etat.statuts || []).forEach(function (s) { statuts[s.periode + '|' + s.poste] = s.statut; });

    // Les charges fixes, l'épargne et les revenus fixes de ce mois : passés ou à venir.
    var debutSuivi = soldes.length ? periodeDuSolde(soldes[0], J).index : per.index;
    var fixes = [], lissees = [], aVenir = 0, revenusFixes = 0, reserves = 0, rapatriements = 0, epargne = { objectif: 0, versee: 0, aVenir: 0 };
    postes.forEach(function (p) {
      if (p.genre !== 'fixe' && p.genre !== 'epargne' && p.genre !== 'revenu') return;
      var a = centimes(p.montant), k = Number(p.frequence) || 1;
      var d = occurrence(p, per);
      if (d) {
        var force = statuts[per.cle + '|' + p.id];
        var auto = solde && d < solde.date ? 'paye' : 'attendu';
        var statut = force === 'paye' || force === 'attendu' ? force : auto;
        fixes.push({ id: p.id, libelle: p.libelle, genre: p.genre, date: d, montant: a, statut: statut, force: statut !== auto });
        if (statut === 'attendu') { if (p.genre === 'revenu') revenusFixes += a; else aVenir += a; }
        if (p.genre === 'epargne') { epargne.objectif += a; if (statut === 'paye') epargne.versee += a; else epargne.aVenir += a; }
      }
      if (k > 1 && p.genre === 'fixe') {
        // Lissée : depuis la dernière échéance (ou le début du suivi), un k-ième par mois, ce mois-ci compris, mis de
        // côté. Transféré sur l'épargne (case à cocher), il n'est plus à garder sur le compte ; le mois de l'échéance,
        // ce qui a été transféré pendant le cycle est à rapatrier pour payer la facture.
        var j = 1;
        while (j < k && !occurrence(p, periodeDecalee(per, -j, J))) j++;
        var debutCycle = periodeDecalee(per, 1 - j, J).debut;
        var transfere = 0, transfertsCeMois = [], rapatrie = 0;
        (etat.depenses || []).forEach(function (x) {
          if (x.poste !== p.id || x.date < debutCycle || x.date >= per.fin) return;
          if (estTransfert(x)) {
            transfere += centimes(x.montant);
            if (x.date >= per.debut) transfertsCeMois.push({ id: x.id, date: x.date, montant: centimes(x.montant) });
          } else if (estRevenu(x) && x.date >= per.debut) rapatrie += centimes(x.montant);
        });
        var reserve = 0, aTransferer = 0, aRapatrier = 0;
        if (!d) {
          var n = Math.min(j, k - 1, per.index - debutSuivi + 1);
          reserve = Math.round(a * Math.max(n, 0) / k);
          aTransferer = Math.max(0, reserve - transfere);
        } else {
          aRapatrier = Math.max(0, transfere - rapatrie);
        }
        reserves += aTransferer;
        rapatriements += aRapatrier;
        lissees.push({ id: p.id, libelle: p.libelle, montant: a, frequence: k, parMois: Math.round(a / k), reserve: reserve,
                       transfere: transfere, aTransferer: aTransferer, transfertsCeMois: transfertsCeMois,
                       aRapatrier: aRapatrier, rapatrie: rapatrie,
                       echeanceCeMois: !!d, prochaine: d || prochaineOccurrence(p, per, J) });
      }
    });

    // Les dépenses et revenus encodés de ce mois. Un revenu prévu à une date à venir n'est pas encore dans le solde.
    var mouvements = (etat.depenses || []).filter(function (x) { return x.date >= per.debut && x.date < per.fin; }).sort(parDate);
    var depenses = mouvements.filter(function (x) { return !estRevenu(x); });
    var nonDebitees = 0, revenusAttendus = 0;
    var lignesDep = mouvements.map(function (x) {
      var pas = solde ? apresSolde(x, solde) : false, rev = estRevenu(x);
      if (pas) { if (rev) revenusAttendus += centimes(x.montant); else nonDebitees += centimes(x.montant); }
      return { id: x.id, date: x.date, libelle: x.libelle, poste: x.poste, montant: centimes(x.montant), revenu: rev,
               transfert: estTransfert(x), pasEncoreDansSolde: pas };
    });
    /** Ce qu'un mouvement a fait sortir du compte : + une dépense, − un revenu. */
    function sortie(x) { return estRevenu(x) ? -centimes(x.montant) : centimes(x.montant); }

    // Les dépenses pré-enregistrées : les récurrentes réservent ce qui reste à faire ce mois-ci.
    var favoris = [], favorisReste = 0;
    postes.forEach(function (p) {
      if (p.genre !== 'favori') return;
      var faits = depenses.filter(function (x) { return x.poste === p.id; }).length;
      var rec = estRecurrent(p), fois = rec ? (Number(p.fois) || 1) : 0;
      var reste = rec ? Math.max(0, fois - faits) * centimes(p.montant) : 0;
      favorisReste += reste;
      favoris.push({ id: p.id, libelle: p.libelle, emoji: p.emoji || '', montant: centimes(p.montant), recurrent: rec,
                     fois: fois, faits: faits, reste: reste });
    });

    var joursTotal = numJour(per.fin) - numJour(per.debut);
    var depart = Math.max(numJour(aujourdhui), numJour(per.debut));
    var joursRestants = Math.max(1, numJour(per.fin) - depart);

    var res = {
      aConfigurer: false, aJour: aJour, plan: plan,
      periode: { cle: per.cle, debut: per.debut, fin: per.fin, joursTotal: joursTotal, joursRestants: joursRestants },
      solde: solde ? { date: solde.date, compte: centimes(solde.montant), carte: Math.abs(centimes(solde.carte)), net: net(solde),
                       salaireAttendu: salaireAttendu(solde, per, salaire) } : null,
      fixes: fixes.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }),
      lissees: lissees, favoris: favoris, depenses: lignesDep, epargne: epargne,
      totaux: { fixesAVenir: aVenir, reserves: reserves, recurrentesAVenir: favorisReste, depensesNonDebitees: nonDebitees,
                revenusAttendus: revenusAttendus, rapatriements: rapatriements, revenusFixesAVenir: revenusFixes },
      rav: null, parJour: null, projection: null, epargnePossible: null, methode: null, variablesDepensees: null,
    };
    if (!solde) return res;

    res.rav = res.solde.net + res.solde.salaireAttendu - aVenir - reserves - favorisReste - nonDebitees + revenusAttendus + rapatriements + revenusFixes;
    res.parJour = Math.floor(res.rav / joursRestants);

    // Ce que tu dépenses vraiment en variables : entre deux soldes de ce mois, à au moins 3 jours d'écart,
    // ce qui est parti sans être une charge fixe ni une dépense encodée (un revenu encodé entre les deux est rendu).
    // Sinon, le plan.
    var soldesMois = soldes.filter(function (s) { return periodeDuSolde(s, J).index === per.index; });
    var taux = null;
    if (soldesMois.length >= 2) {
      var s1 = soldesMois[0], s2 = soldesMois[soldesMois.length - 1], nj = numJour(s2.date) - numJour(s1.date);
      if (nj >= 3) {
        var fixesEntre = 0, depEntre = 0;
        fixes.forEach(function (f) {
          if (f.statut === 'paye' && f.date >= s1.date && f.date < s2.date) fixesEntre += f.genre === 'revenu' ? -f.montant : f.montant;
        });
        mouvements.forEach(function (x) { if (apresSolde(x, s1) && !apresSolde(x, s2)) depEntre += sortie(x); });
        var variables = (net(s1) + salaireAttendu(s1, per, salaire)) -
                        (net(s2) + salaireAttendu(s2, per, salaire)) - fixesEntre - depEntre;
        res.variablesDepensees = { montant: Math.max(0, variables), depuis: s1.date, jours: nj };
        taux = Math.max(0, variables) / nj;
        res.methode = 'reel';
      }
    }
    if (taux === null && plan.enveloppe !== null && joursTotal > 0) {
      taux = Math.max(0, plan.enveloppe) / joursTotal;
      res.methode = 'plan';
    }
    if (taux !== null) {
      res.projection = Math.round(taux * joursRestants);
      res.epargnePossible = res.rav - res.projection;
    }
    return res;
  }

  racine.RAV = {
    calculer: calculer, periodeDe: periodeDe, periodeDuMois: periodeDuMois, occurrence: occurrence,
    planDuMois: planDuMois, centimes: centimes, numJour: numJour, iso: iso,
  };
})(typeof window !== 'undefined' ? window : globalThis);
