# Guide de Test des Règles Métier - Cash Point

## 🚀 Démarrage Rapide

Le projet est actuellement en cours d'exécution:
- **Backend**: http://localhost:5000
- **Frontend**: http://localhost:5174

## 📝 Test via l'Interface Frontend

### Étape 1: Créer un Compte
1. Ouvrez http://localhost:5174 dans votre navigateur
2. Cliquez sur "Sign Up"
3. Remplissez le formulaire:
   - **Nom**: Test User
   - **Email**: test@example.com
   - **Mot de passe**: password123
   - **Rôle**: Operator (défaut)

### Étape 2: Se Connecter
1. Cliquez sur "Login"
2. Entrez les identifiants créés

### Étape 3: Initialiser la Caisse
1. Allez à la page "Caisse"
2. Cliquez sur "Initialiser la caisse"
3. Remplissez les soldes initiaux pour chaque opérateur (YAS, AIRTEL, ORANGE)
   - Exemple: Cash = 10000, Mobile = 5000

### Étape 4: Démarrer la Journée
1. Cliquez sur "Démarrer la journée"
2. Vous pouvez maintenant créer des opérations

### Étape 5: Configurer les Tarifs
1. Allez à la page "Tarifs"
2. Ajoutez des tarifs pour chaque type d'opération par opérateur
   - Exemple pour YAS - DEPOT:
     - Montant min: 0
     - Montant max: 100000
     - OperatorFee: 0
     - PersonalFee: 0
     - Gain: 100

## 🧪 Test des Règles Métier via API

### Authentification

```bash
# 1. Créer un compte
curl -X POST http://localhost:5000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Agent",
    "email": "agent@cashpoint.local",
    "password": "testpass123",
    "role": "operator"
  }'

# 2. Se connecter et obtenir un token
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "agent@cashpoint.local",
    "password": "testpass123"
  }'

# Gardez le token pour les requêtes suivantes
# TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Initialiser la Caisse

```bash
# Initialiser les soldes
curl -X POST http://localhost:5000/api/cashbox/initialize \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "cashBalance": 1000000,
    "mobileBalance": 500000
  }'

# Démarrer la journée
curl -X POST http://localhost:5000/api/cashbox/day/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'
```

### Configurer les Tarifs

```bash
# Créer un tarif pour DEPOT (YAS)
curl -X POST http://localhost:5000/api/tariffs/upsert \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "operator": "YAS",
    "operationType": "DEPOT",
    "minAmount": 0,
    "maxAmount": 100000,
    "operatorFee": 0,
    "personalFee": 0,
    "gainCumule": 100
  }'

# Créer un tarif pour RETRAIT (YAS)
curl -X POST http://localhost:5000/api/tariffs/upsert \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "operator": "YAS",
    "operationType": "RETRAIT",
    "minAmount": 0,
    "maxAmount": 100000,
    "operatorFee": 500,
    "personalFee": 200,
    "gainCumule": 300
  }'

# Créer un tarif pour CREDIT (YAS)
curl -X POST http://localhost:5000/api/tariffs/upsert \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "operator": "YAS",
    "operationType": "CREDIT",
    "minAmount": 0,
    "maxAmount": 100000,
    "operatorFee": 300,
    "personalFee": 100,
    "gainCumule": 200
  }'

# Créer un tarif pour TRANSFERT (YAS)
curl -X POST http://localhost:5000/api/tariffs/upsert \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "operator": "YAS",
    "operationType": "TRANSFERT",
    "minAmount": 0,
    "maxAmount": 100000,
    "operatorFee": 400,
    "personalFee": 150,
    "gainCumule": 250
  }'
```

### Tester les Opérations

#### Test 1: DEPOT (100 Ar)
```bash
# Prévisualisation
curl -X POST http://localhost:5000/api/operations/preview \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "operator": "YAS",
    "operationType": "DEPOT",
    "amount": 100,
    "includeWithdrawalFeeForTransfer": false
  }'

# Résultat attendu:
# {
#   "operatorFee": 0,
#   "personalFee": 0,
#   "clientFee": 0,
#   "gain": 100,
#   "totalFee": 100
# }

# Créer l'opération
curl -X POST http://localhost:5000/api/operations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "operator": "YAS",
    "operationType": "DEPOT",
    "amount": 100,
    "externalId": "depot-001",
    "reference": "REF001",
    "customerPhone": "260341234567",
    "customerName": "Client Test"
  }'
```

#### Test 2: CREDIT (200 Ar)
```bash
# Prévisualisation
curl -X POST http://localhost:5000/api/operations/preview \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "operator": "YAS",
    "operationType": "CREDIT",
    "amount": 200
  }'

# Résultat attendu:
# {
#   "operatorFee": 300,
#   "personalFee": 100,
#   "clientFee": 400,
#   "gain": 200,
#   "totalFee": 600
# }

# Créer l'opération
curl -X POST http://localhost:5000/api/operations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "operator": "YAS",
    "operationType": "CREDIT",
    "amount": 200,
    "externalId": "credit-001",
    "reference": "REF002",
    "customerPhone": "260342345678",
    "customerName": "Client Credit"
  }'
```

#### Test 3: RETRAIT (150 Ar)
```bash
# Prévisualisation
curl -X POST http://localhost:5000/api/operations/preview \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "operator": "YAS",
    "operationType": "RETRAIT",
    "amount": 150
  }'

# Résultat attendu:
# {
#   "operatorFee": 500,
#   "personalFee": 200,
#   "clientFee": 700,
#   "gain": 300,
#   "totalFee": 850
# }

# Créer l'opération
curl -X POST http://localhost:5000/api/operations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "operator": "YAS",
    "operationType": "RETRAIT",
    "amount": 150,
    "externalId": "retrait-001",
    "reference": "REF003",
    "customerPhone": "260343456789",
    "customerName": "Client Retrait"
  }'
```

#### Test 4: TRANSFERT (100 Ar)
```bash
# Prévisualisation
curl -X POST http://localhost:5000/api/operations/preview \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "operator": "YAS",
    "operationType": "TRANSFERT",
    "amount": 100,
    "includeWithdrawalFeeForTransfer": false
  }'

# Résultat attendu:
# {
#   "operatorFee": 400,
#   "personalFee": 150,
#   "clientFee": 550,
#   "gain": 250,
#   "totalFee": 650
# }

# Créer l'opération
curl -X POST http://localhost:5000/api/operations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "operator": "YAS",
    "operationType": "TRANSFERT",
    "amount": 100,
    "externalId": "transfert-001",
    "reference": "REF004",
    "customerPhone": "260344567890",
    "customerName": "Client Transfert"
  }'
```

#### Test 5: TRANSFERT avec Frais de Retrait
```bash
curl -X POST http://localhost:5000/api/operations/preview \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "operator": "YAS",
    "operationType": "TRANSFERT",
    "amount": 100,
    "includeWithdrawalFeeForTransfer": true
  }'

# Résultat attendu (somme des frais TRANSFERT + RETRAIT):
# {
#   "operatorFee": 900,     // 400 (transfert) + 500 (retrait)
#   "personalFee": 350,     // 150 (transfert) + 200 (retrait)
#   "clientFee": 1250,
#   "gain": 550,            // 250 (transfert) + 300 (retrait)
#   "totalFee": 1350
# }
```

### Vérifier les Soldes

```bash
# Obtenir l'état de la caisse
curl -X GET http://localhost:5000/api/cashbox \
  -H "Authorization: Bearer $TOKEN"

# Obtenir les balances par opérateur
curl -X GET http://localhost:5000/api/cashbox \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.balances'

# Obtenir l'historique des opérations du jour
curl -X GET "http://localhost:5000/api/operations/history?period=daily" \
  -H "Authorization: Bearer $TOKEN"

# Obtenir le dashboard
curl -X GET http://localhost:5000/api/dashboard \
  -H "Authorization: Bearer $TOKEN"
```

### Tester l'Annulation

```bash
# Obtenir l'ID d'une opération
curl -X GET "http://localhost:5000/api/operations/history?period=daily" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.[] | select(.operationType == "DEPOT") | .id' -r

# Annuler l'opération (remplacez OPERATION_ID par l'ID réel)
curl -X POST http://localhost:5000/api/operations/OPERATION_ID/cancel \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'
```

## 🔍 Vérification des Résultats

### Après un DEPOT de 100 Ar (Gain=100):
```
Avant: cashBalance = 1000000, mobileBalance = 500000
Après: cashBalance = 1000100, mobileBalance = 499900
```
✅ DEPOT: `cashBalance += 100`, `mobileBalance -= 100 - 100 (gain)`

### Après un CREDIT de 200 Ar (OF=300, PF=100, Gain=200):
```
Avant: cashBalance = 1000100, mobileBalance = 499900
Après: cashBalance = 1000400, mobileBalance = 499700
```
✅ CREDIT: `cashBalance += 200 + 300 (OF)`, `mobileBalance -= 200 - 200 (gain)`

### Après un RETRAIT de 150 Ar (OF=500, PF=200, Gain=300):
```
Avant: cashBalance = 1000400, mobileBalance = 499700
Après: cashBalance = 1000550, mobileBalance = 499500
```
✅ RETRAIT: `cashBalance += 150 + 700 (CF)`, `mobileBalance -= 150 + 500 (OF) - 300 (gain)`

## 📊 Synchronisation Offline

Le système supporte la synchronisation offline via IndexedDB. Les opérations stockées localement seront synchronisées quand la connexion revient.

Pour tester:
1. Ouvrez DevTools (F12)
2. Allez à Network et activez "Offline"
3. Créez des opérations (elles seront stockées dans IndexedDB)
4. Désactivez "Offline"
5. Les opérations seront automatiquement synchronisées

## ✅ Checklist de Validation

- [ ] DEPOT: Les frais sont correctement appliqués (devrait être 0)
- [ ] CREDIT: Les frais operateur sont ajoutés au cashBalance
- [ ] RETRAIT: Les frais operateur réduisent le mobileBalance
- [ ] TRANSFERT: Les deux types de frais sont appliqués
- [ ] Gain: Le gain est ajouté au mobileBalance pour tous les types
- [ ] Annulation: L'opération peut être annulée et les soldes restaurés
- [ ] Tarifs: Les tarifs sont utilisés selon le montant et le type d'opération
- [ ] Offline: Les opérations offline sont synchronisées correctement
- [ ] Dashboard: Les indicateurs sont calculés correctement
- [ ] Historique: L'historique journalier est affiché correctement
