$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/postgres"
$env:JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
$env:PASSWORD_PEPPER = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
$env:JWT_REFRESH_SECRET = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
$env:AUDIT_ENCRYPTION_KEY = "af0f3444768c1eaa56b08c4ff7ae9d84edde84e1a76d2cce7e948926b8e33826"
$env:PORT = "3000"
$env:NODE_ENV = "development"
$env:SEED_DEMO_DATA = "true"

Set-Location "E:\Potential-gold\Sangam\SANGAM-PRODUCTION"
node backend/src/server.js
