# Commons

Base de connaissances pour une communauté Root : guides, outils, références, ressources. Pensée pour être complémentaire à Newsroom, mais réglable pour n'importe quelle communauté (espaces, rôles, types de page, accueil).

## Ce que contient l'app

- **Espaces** : un espace principal lu par toute la communauté, et des groupes créés à partir d'un rôle Root, visibles par tous ou cachés. Niveau par rôle : Invisible, Read, Suggest and comment, Edit and publish, Admin. Admins de l'app choisis dans les réglages Root.
- **Pages façon Wikipédia** : onglets Read / Edit (ou Suggest changes) / History, infobox des champs du type, sommaire, sources en notes numérotées et liste References, catégories et étiquettes en bas de page, « What links here », liens rouges vers les pages qui n'existent pas.
- **Brouillon et publication** : on écrit dans un brouillon partagé (écriture en direct, mode suggestion, commentaires, historique des versions) ; les lecteurs voient la dernière version publiée jusqu'à la prochaine publication. Chaque publication est gardée (onglet History).
- **Contribution de la communauté**, par page : éditeurs seulement (par défaut), suggestions des membres, ou édition du brouillon par les membres (un éditeur publie).
- **Types de page** réglables (Guide, Tool, Reference, Resource, Page au départ) : champs de l'infobox (texte, lien, nombre, date, liste, image) et texte de départ.
- **Catégories** en arbre, **étiquettes**, **brouillons**, **traductions** liées (une page par langue), déplacement d'une page vers un autre espace.
- **Accueil** de chaque espace en blocs : texte, recherche, pages en vedette, dernières mises à jour, liste d'une catégorie ou d'une étiquette, liens utiles.
- **Recherche** plein texte (SQLite FTS5) avec filtres espace, catégorie, type, étiquette.
- **Signalements** : « Report an error or suggest an addition » sur chaque page ; liste des signalements pour les éditeurs.
- **Notifications Root** : mentions, commentaires, suggestions, page ou catégorie suivie republiée, signalement dans un espace qu'on édite. Préférences par membre.
- **Fichiers** : photos avec légende et fichiers joints (PDF, etc.) dans le texte.
- Interface dans les 8 langues de Root, lisibilité et correcteur orthographique repris de Newsroom.

## Avant le premier lancement

Créer l'app **Commons** dans le Root Developer Portal et coller son identifiant dans `root-manifest.json` (champ `id`, à la place de `COMMONS_APP_ID`). Ne pas réutiliser l'identifiant de Newsroom : les deux apps se remplaceraient.

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

Les tests font tourner deux éditeurs synchronisés et vérifient les suggestions de texte, les changements de structure (titre), les photos et la conversion d'un brouillon en page publiée.

## Le correctif de y-prosemirror

y-prosemirror 1.3.7 ne synchronise pas les marques posées sur un bloc entier. Sans correctif, une suggestion « paragraphe → titre » apparaît comme déjà acceptée chez les autres. `patches/y-prosemirror+1.3.7.patch` stocke ces marques dans un attribut `__marks`. Il est appliqué automatiquement par `npm install` (patch-package). Le test « syncs a suggested heading change » échoue sans lui.

## Limites connues

- prosemirror-suggest-changes 0.1.8 plante quand on refuse une suggestion de structure posée sur un bloc qui contient déjà une suggestion de texte.
- Le serveur ne peut pas vérifier qu'un membre de niveau Comment n'envoie que des suggestions : l'éditeur l'impose.
- Le filtre par catégorie de la recherche demande de choisir un espace.
- Un texte tapé juste à côté d'une suggestion peut être rattaché à cette suggestion et à son auteur.
