# Cash Point

Cash Point est une application complète de gestion de caisse destinée aux points de vente mobiles et aux opérateurs de services financiers. Elle combine un backend Node.js/Express, une base de données PostgreSQL gérée par Prisma, et un frontend React/Vite avec support offline-first.

## But du projet

L'objectif est de permettre à un agent de caisse de :
- suivre les soldes de trésorerie physique (`cash`) et mobile pour plusieurs opérateurs,
- saisir des opérations clients (`DEPOT`, `RETRAIT`, `TRANSFERT`, `CREDIT`),
- appliquer automatiquement des frais et des gains selon des règles tarifaires,
- gérer l'ouverture et la clôture de la journée de caisse,
- stocker les opérations en local lorsque l'appareil est hors ligne,
- synchroniser les transactions automatiquement lorsque la connexion revient.




## Structure du projet

### Arborescence principale

- `backend/`
  - `package.json`
  - `prisma/schema.prisma`
  - `src/index.js` : point d'entrée du serveur Express
  - `src/config/db.js` : configuration de la connexion Prisma
  - `src/middleware/auth.js` : middleware JWT
  - `src/routes/` : routes API
    - `auth.js`
    - `cashbox.js`
    - `dashboard.js`
    - `operations.js`
    - `tariffs.js`
  - `src/services/cashService.js` : logique métier, calcul des fees, mise à jour des soldes

- `frontend/`
  - `package.json`
  - `vite.config.js`
  - `src/App.jsx` : logique principale de l'application
  - `src/main.jsx` : point d'entrée React
  - `src/services.js` : wrapper API et IndexedDB
  - `src/index.css` : styles globaux
  - `public/` : ressources statiques

## Fonctionnalités principales

### Authentification et utilisateurs
- Inscription d'un nouvel utilisateur
- Connexion et génération d'un token JWT
- Lecture du profil connecté
- Protection des routes API via middleware JWT

### Gestion de caisse
- Initialisation des soldes des opérateurs
- Activation de la journée de caisse (`dayStarted`)
- Fermeture de la journée de caisse
- Réapprovisionnement des soldes opérateurs
- Consultation des soldes cash/mobile par opérateur

### Opérations clients
- Saisie de transaction : `DEPOT`, `RETRAIT`, `TRANSFERT`, `CREDIT`
- Prévisualisation automatique des frais avant validation
- Calcul automatique de :
  - `operatorFee`
  - `personalFee`
  - `clientFee`
  - `gain`
  - `totalFee`
- Annulation d'une transaction client
- Edition limitée de la référence d'une transaction
- Historique journalier

### Règles métier

- Définition des opérateurs : `YAS`, `AIRTEL`, `ORANGE`
- Types d'opération : `DEPOT`, `RETRAIT`, `TRANSFERT`, `CREDIT`
- Règles de solde :
  - `DEPOT`: `cashBalance = cashBalanceInitial + montant`, `mobileBalance = mobileBalanceInitial - montant + Gain`
  - `CREDIT` : `cashBalance = cashBalanceInitial + montant + operatorFee`, `mobileBalance = mobileBalanceInitial - montant + Gain`
  - `RETRAIT` : `cashBalance = cashBalanceInitial + montant + operatorFee + personalFee`, `mobileBalance = mobileBalanceInitial - montant - operatorFee + Gain`
  - `TRANSFERT` : `mobileBalance = mobileBalanceInitial - montant - operatorFee + Gain`, `cashBalance = cashBalanceInitial + montant + operatorFee + personalFee`
- Les frais client sont composés de `operatorFee + personalFee`
- Les valeurs sont calculées à partir des tarifs configurés pour chaque opérateur et chaque type d'opération

### Tarifs
- Lecture de tous les tarifs
- Création / mise à jour d'un tarif par opérateur, type, intervalle montant
- Suppression et édition de tarifs
- Tarifs indexés sur les montants minimaux et maximaux

### Synchronisation offline-first
- Stockage des opérations hors ligne dans IndexedDB
- Envoi différé des opérations quand le réseau revient
- Réconciliation côté serveur avec déduplication via `externalId`
- Message de retour : nombre synchronisé, doublons, erreurs

### Dashboard et indicateurs
- Total cash et total mobile
- Gain du jour
- Nombre d'opérations du jour
- Montant des réapprovisionnements du jour
- Alertes de solde négatif ou de caisse insuffisante
- Vue par opérateur et statistiques de la journée

## Base de données et schéma Prisma

### Modèles clés

- `User` : compte utilisateur et rôle
- `CashBox` : état global de la caisse, ouverture/fermeture de journée
- `OperatorBalance` : soldes par opérateur
- `Tariff` : tarifs par opérateur/type/intervalle de montant
- `Operation` : historique complet des transactions

### Enregistrements importants

- `externalId` sur `Operation` : permet de gérer la déduplication lors de la synchronisation offline
- `kind` sur `Operation` : distingue `TRANSACTION`, `OPENING`, `CLOSING`, `REAPPRO`
- `referenceEditCount` : limite l'édition des références à deux fois
- `isCancelled` : marque les transactions annulées


## Endpoints API principaux

- `GET /api/health`
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/cashbox`
- `POST /api/cashbox/initialize`
- `POST /api/cashbox/day/start`
- `POST /api/cashbox/day/close`
- `POST /api/cashbox/replenish`
- `GET /api/cashbox/journals`
- `GET /api/dashboard`
- `POST /api/dashboard/sync`
- `POST /api/operations/preview`
- `POST /api/operations`
- `PATCH /api/operations/:id/reference`
- `POST /api/operations/:id/cancel`
- `GET /api/operations/history?period=daily|semester`
- `GET /api/tariffs`
- `POST /api/tariffs/upsert`
- `PATCH /api/tariffs/:id`
- `DELETE /api/tariffs/:id`


## Améliorations possibles


- Export CSV/PDF des journaux de caisse
- Déploiement Docker / cloud
- Authentification plus robuste (reset de mot de passe, validation email)

## Résumé des outils utilisés

- React, Vite, JavaScript
- Node.js, Express, Prisma
- PostgreSQL
- JWT
- IndexedDB
- `cors`, `dotenv`, `jsonwebtoken`, `pg`, `nodemon`

---

Ce fichier décrit entièrement le projet, ses fonctionnalités, sa structure et sa configuration pour permettre de le reconstruire