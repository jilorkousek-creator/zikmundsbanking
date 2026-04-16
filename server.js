console.log("SERVER STARTUJE – FINAL VERZE");


const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const session = require("express-session");
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail(to, subject, text) {
  try {
    await resend.emails.send({
      from: "Zikmunds Banking <no-reply@zikmundsbanking.fun>",
      to: to,
      subject: subject,
      text: text
    });

    console.log("Email sent");
  } catch (err) {
    console.error("Email error:", err);
  }
}

const PEPPER = "ZIKMUNDS_BANKING_SUPER_SECRET_2026";

const app = express();

// middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "views")));

app.use(
  session({
    secret: "zikmunds_session_secret_FINAL",
    resave: false,
    saveUninitialized: false,
  })
);

function requireLogin(req, res, next) {
  if (!req.session.username) {
    return res.redirect("/");
  }
  next();
}

// database 
const dbPath = path.join(__dirname, "database2.db");
console.log("POUŽÍVÁM DB:", dbPath);

const db = new sqlite3.Database(dbPath);

//users tabulka

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jmeno TEXT,
    prijmeni TEXT,
    username TEXT UNIQUE,
    rodnecislo TEXT UNIQUE,
    bydliste TEXT,
    email TEXT,
    password TEXT,
    rybicky INTEGER DEFAULT 100,
    sporici INTEGER DEFAULT 0
  )
`);

// transactions tabulka

db.run(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user TEXT,
    to_user TEXT,
    amount INTEGER,
    type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// routes

// hlavni stranka
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});


// registrace
app.post("/register", async (req, res) => {
  const {
    jmeno,
    prijmeni,
    rodnecislo,
    bydliste,
    email,
    password,
  } = req.body;

  const username = req.body.username.trim().toLowerCase();

  try {
    const hashedPassword = await bcrypt.hash(password + PEPPER, 12);

    db.run(
      `INSERT INTO users
       (jmeno, prijmeni, username, rodnecislo, bydliste, email, password)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        jmeno,
        prijmeni,
        username,
        rodnecislo,
        bydliste,
        email,
        hashedPassword,
      ],
      function (err) {
        if (err) {
          console.error(err);
          return res.send("Chyba při registraci");
        }

       
        db.run(
          `INSERT INTO transactions (from_user, to_user, amount, type)
           VALUES (?, ?, ?, ?)`,
          ["BANKA", username, 100, "bonus"],
          (err) => {
            if (err) {
              console.error(err);
            }
          }
        );

        req.session.username = username;

req.session.save(() => {
  res.redirect("/dashboard");
});

      }
    );
  } catch (err) {
    console.error(err);
    res.send("Chyba serveru");
  }
});


// login
app.post("/login", (req, res) => {
  const username = req.body.username.trim().toLowerCase();
  const password = req.body.password;

  db.get(
    "SELECT * FROM users WHERE username = ?",
    [username],
    async (err, user) => {
      if (err) {
        console.error(err);
        return res.send("Chyba serveru");
      }

      if (!user) {
        return res.send("Uživatel neexistuje");
      }

      const isMatch = await bcrypt.compare(password + PEPPER, user.password);

      if (!isMatch) {
        return res.send("Špatné heslo");
      }

      req.session.username = user.username;

      req.session.save(() => {
        res.redirect("/dashboard");
      });
    }
  );
});

// dashboard
app.get("/dashboard", (req, res) => {
  if (!req.session.username) {
    return res.redirect("/");
  }

  const username = req.session.username;

  db.get(
    "SELECT jmeno, rybicky, sporici FROM users WHERE username = ?",
    [username],
    (err, user) => {
      if (err || !user) {
        return res.send("Chyba při načítání dashboardu");
      }

      db.all(
        `SELECT * FROM transactions 
         WHERE from_user = ? OR to_user = ?
         ORDER BY created_at DESC`,
        [username, username],
        (err, transactions) => {
          if (err) {
            return res.send("Chyba při načítání transakcí");
          }

          let transactionsHtml = "";

          transactions.forEach((t) => {
            let direction = "";

            if (t.to_user === username) {
              direction = `+${t.amount} 🐟 (od ${t.from_user})`;
            } else {
              direction = `-${t.amount} 🐟 (pro ${t.to_user})`;
            }

            transactionsHtml += `<li>${direction} – ${t.type}</li>`;
          });

          res.send(`
            <link rel="stylesheet" href="/style.css">

            <header>
            <h1>🐱 Zikmund’s Banking</h1>
            </header>

            <div class="container">

  <div class="card">

            <p>Vítej, <strong>${user.jmeno}</strong></p>
            <p>💰 Stav účtu: <strong>${user.rybicky} rybiček</strong></p>
            <p>Spořicí účet: <strong>${user.sporici} rybiček</strong></p>
            </div>
            <hr>
            <div class="card">
            <h2> Historie transakcí</h2>
            <ul>
              ${transactionsHtml || "<li>Žádné transakce</li>"}
            </ul>

            <hr>
            </div>

            <div class="card">
            <h2>🐟 Odeslat rybičky</h2>
            <form method="POST" action="/transfer">
       <label>
          Komu (username):
        <input type="text" name="to_user" required>
         </label>
        <br><br>

       <label>
           Kolik rybiček:
          <input type="number" name="amount" min="1" required>
      </label>
     <br><br>

     <label>
       Tvoje heslo:
       <input type="password" name="password" required>
      </label>

  <button type="submit">Odeslat</button>
</form>
<hr>
</div>

<div class="card">
<h2>Spořicí účet</h2>

<form method="POST" action="/to-savings">
  <input type="number" name="amount" min="1" required>
  <button type="submit">Převést na spořák</button>
</form>

<br>

<form method="POST" action="/from-savings">
  <input type="number" name="amount" min="1" required>
  <button type="submit">Vybrat ze spořáku</button>
</form>

<br>

<form method="POST" action="/interest">
  <button type="submit">Připsat úrok (5%)</button>
</form>
</div>
            <a href="/logout">Odhlásit se</a>
          `);
        }
      );
    }
  );
});

//transfer
app.post("/transfer", requireLogin, (req, res) => {
  const fromUser = req.session.username;
  const toUser = req.body.to_user;
  const amount = Number(req.body.amount);
  const password = req.body.password;

  if (!amount || amount <= 0 || !Number.isFinite(amount)) {
    return res.send("Neplatná částka");
  }

  if (fromUser === toUser) {
    return res.send("Nemůžeš poslat sám sobě 😺");
  }

  db.get("SELECT * FROM users WHERE username = ?", [fromUser], async (err, sender) => {
    if (!sender) return res.send("Chyba uživatele");

    const isMatch = await bcrypt.compare(password + PEPPER, sender.password);

    if (!isMatch) {
      return res.send("Špatné heslo");
    }

    if (sender.rybicky < amount) {
      return res.send("Nedostatek rybiček 🐟");
    }

    db.get("SELECT * FROM users WHERE username = ?", [toUser], (err, receiver) => {
      if (!receiver) {
        return res.send("Příjemce neexistuje");
      }

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        db.run(
          "UPDATE users SET rybicky = rybicky - ? WHERE username = ?",
          [amount, fromUser]
        );

        db.run(
          "UPDATE users SET rybicky = rybicky + ? WHERE username = ?",
          [amount, toUser]
        );

        // ✅ JEN JEDEN INSERT (FIX DUPLICITY)
        db.run(
          `INSERT INTO transactions (from_user, to_user, amount, type)
           VALUES (?, ?, ?, ?)`,
          [fromUser, toUser, amount, "transfer"]
        );

        // 📧 EMAILY (zůstávají)
        db.get("SELECT email FROM users WHERE username = ?", [fromUser], (err, senderData) => {
          db.get("SELECT email FROM users WHERE username = ?", [toUser], (err, receiverData) => {

            if (senderData && receiverData) {

              sendEmail(
                senderData.email,
                "Odeslal jsi rybičky 🐟",
                `Odeslal jsi ${amount} rybiček uživateli ${toUser}.`
              );

              sendEmail(
                receiverData.email,
                "Přijal jsi rybičky 🐟",
                `Dostal jsi ${amount} rybiček od ${fromUser}.`
              );
            }

          });
        });

        db.run("COMMIT", () => {
          res.redirect("/dashboard");
        });
      });
    });
  });
});

//sporak 
app.post("/to-savings", (req, res) => {
  const username = req.session.username;
  const amount = parseInt(req.body.amount);

  db.get(
    "SELECT rybicky FROM users WHERE username = ?",
    [username],
    (err, user) => {
      if (!user || user.rybicky < amount) {
        return res.send("Nedostatek rybiček");
      }

      db.run(
        "UPDATE users SET rybicky = rybicky - ?, sporici = sporici + ? WHERE username = ?",
        [amount, amount, username]
      );

      db.run(
        `INSERT INTO transactions (from_user, to_user, amount, type)
         VALUES (?, ?, ?, ?)`,
        [username, username, amount, "to_savings"]
      );

      res.redirect("/dashboard");
    }
  );
});

//vyber sporak
app.post("/from-savings", (req, res) => {
  const username = req.session.username;
  const amount = parseInt(req.body.amount);

  db.get(
    "SELECT sporici FROM users WHERE username = ?",
    [username],
    (err, user) => {
      if (!user || user.sporici < amount) {
        return res.send("Nedostatek na spořáku");
      }

      db.run(
        "UPDATE users SET sporici = sporici - ?, rybicky = rybicky + ? WHERE username = ?",
        [amount, amount, username]
      );

      db.run(
        `INSERT INTO transactions (from_user, to_user, amount, type)
         VALUES (?, ?, ?, ?)`,
        [username, username, amount, "from_savings"]
      );

      res.redirect("/dashboard");
    }
  );
});

//pripsani uroku
app.post("/interest", (req, res) => {
  const username = req.session.username;

  db.get(
    "SELECT sporici FROM users WHERE username = ?",
    [username],
    (err, user) => {
      if (!user) return res.redirect("/dashboard");

      const interest = Math.floor(user.sporici * 0.05);

      db.run(
        "UPDATE users SET sporici = sporici + ? WHERE username = ?",
        [interest, username]
      );

      db.run(
        `INSERT INTO transactions (from_user, to_user, amount, type)
         VALUES (?, ?, ?, ?)`,
        ["BANKA", username, interest, "interest"]
      );

      res.redirect("/dashboard");
    }
  );
});



// logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// server start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server běží na portu ${PORT}`);
});
