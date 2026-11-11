require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

// Ensure upload directories exist on startup
fs.mkdirSync(path.join(__dirname, 'uploads/ids'), { recursive: true });
const authRoutes = require('./routes/auth.routes');
const residentRoutes = require('./routes/resident.routes');
const systemAdminRoutes = require('./routes/systemAdmin.routes');
const captainRoutes = require('./routes/captain.routes');
const staffRoutes = require('./routes/staff.routes');
const helpRoutes = require('./routes/help.routes');
const aiRoutes = require('./routes/ai.routes');
const { initRealtime } = require('./node/realtime');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

initRealtime(io);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: true, sameSite: 'lax' }
}));

app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(authRoutes);
app.use(residentRoutes);
app.use(systemAdminRoutes);
app.use(captainRoutes);
app.use(staffRoutes);
app.use(helpRoutes);
app.use(aiRoutes);

app.use((req, res) => {
  res.status(404).send('Page not found.');
});

// Ensure new columns/tables exist (see resident_verification_migration.sql, ai_migration.sql)
require('./actions/schema.actions').ensureSchema();

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
