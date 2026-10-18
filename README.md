# newsroom-root

App éditoriale pour Root : espaces de travail, tableau du pitch à la publication, éditeur collaboratif, archive. Étapes 1 à 6 du cahier des charges.

## Ce que contient l'app

- **Espaces et accès** : un onglet par espace, niveau d'accès par rôle Root (Invisible, Read, Comment, Edit, Admin). Admins de l'app choisis dans les réglages Root.
- **Tableau** : Planned, In progress, For review, Awaiting publication, zone Published. Glisser-déposer, bouton Start, plusieurs auteurs par article.
- **Fiche projet** : pitch, onglets de texte (langue, corbeille), champs et statuts.
- **Écriture en direct** : Yjs relayé par le serveur et les diffusions Root, frappes regroupées toutes les 200 ms, messages découpés au-delà de 200 Ko (limite Root : 256 Kio). Curseurs et noms des présents.
- **Mode suggestion** : couleur et nom par auteur, accepter ou refuser une suggestion ou toutes.
- **Commentaires** : sur un passage, réponses, mentions @, Resolve et Reopen. Les fils vivent dans le document Yjs.
- **Historique** : version automatique toutes les 10 minutes d'écriture, versions nommées, comparaison mot à mot, restauration (annulable).
- **Compteurs** : mots de l'onglet et de la sélection, lisibilité (Flesch en anglais, Kandel et Moles en français).
- **Photos** : sélecteur de fichiers Root, légende sous la photo. **Copy article** copie le texte propre pour Word.
- **Champs et statuts** : bibliothèque commune (texte ou liste), icône Lucide et couleur, colonnes, affichage sur la carte, rôle qui remplit, approbations qui bloquent une colonne.
- **Notifications Root** : mentions, commentaires, suggestions, changements de colonne et de statut, approbations, veille de la date limite, règles par rôle. Jamais pour son propre geste, une seule notification par rafale, préférences par membre (cloche).
- **Archive** : par date de publication, filtres (espace, auteur, période, champs) et recherche dans les titres et les textes, en lecture seule. Un admin peut ramener un article au tableau pendant `retention.archiveDays` jours (90 par défaut) ; ensuite l'archive définitive élague l'historique et compresse les textes.

## Lancer en local

Il faut Node 22 ou plus récent.

```bash
npm install          # applique aussi le correctif de y-prosemirror (dossier patches/)
npm run build
```

Créer `server/.env` (ce fichier n'est jamais versionné) :

```
DEV_TOKEN=<ton jeton du Root Developer Portal>
```

Puis, dans deux terminaux :

```bash
cd server && npm run server   # serveur dans le DevHost Root
cd client && npm run client   # client dans le navigateur
```

Le DevHost ajoute une barre en haut du client pour choisir le membre. Ouvre plusieurs onglets pour simuler plusieurs personnes, ou ouvre l'app dans la communauté de test avec l'application Root.

## Tests

```bash
cd client && npm test
```

Les tests font tourner deux éditeurs synchronisés et vérifient les suggestions de texte, les changements de structure (titre) et les photos.

## Le correctif de y-prosemirror

y-prosemirror 1.3.7 ne synchronise pas les marques posées sur un bloc entier. Sans correctif, une suggestion « paragraphe → titre » apparaît comme déjà acceptée chez les autres. `patches/y-prosemirror+1.3.7.patch` stocke ces marques dans un attribut `__marks`. Il est appliqué automatiquement par `npm install` (patch-package). Le test « syncs a suggested heading change » échoue sans lui.

## Limites connues

- prosemirror-suggest-changes 0.1.8 plante quand on refuse une suggestion de structure posée sur un bloc qui contient déjà une suggestion de texte.
- Le serveur ne peut pas vérifier qu'un membre de niveau Comment n'envoie que des suggestions : l'éditeur l'impose.
- Réglages Root de type nombre : le DevHost plante dessus, d'où des réglages texte (`trashDays`, `archiveDays`).
- Les filtres par champ de l'archive demandent de choisir un espace.
- Un texte tapé juste à côté d'une suggestion peut être rattaché à cette suggestion et à son auteur.
