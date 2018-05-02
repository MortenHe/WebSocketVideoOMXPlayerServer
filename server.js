'use strict';

let app = require('express')();
let http = require('http').Server(app);
let io = require('socket.io')(http);

const { execSync } = require('child_process');

let timerId = null;
let sockets = new Set();

//Bei Verbindung eines Sockets
io.on('connection', (socket) => {

    //Socket in Liste einfuegen
    sockets.add(socket)
    console.log(`Socket ${socket.id} added`);

    //Wenn Timer noch nicht laueft -> Timer starten
    if (!timerId) {
        startTimer();
    }

    //Wenn der Socket eine "set-volume" Message sendet
    socket.on('set-volume', (volume) => {

        //Diesen Wert an Sockets verteilen
        console.log('SET VOLUME TO ' + volume);
        io.emit('send-volume-message', volume);
    });

    //Beim disconnect eines Sockets
    socket.on('disconnect', function () {

        //Socket aus Liste werfen
        console.log(`Deleting socket: ${socket.id}`);
        sockets.delete(socket);
        console.log(`Remaining sockets: ${sockets.size}`);
    });
});

//Timer Funktion liefert in regelmaessigen Abstaenden Werte an alle Sockets
function startTimer() {
    console.log("start timer");
    timerId = setInterval(() => {

        //Wenn es keine Sockets mehr gibt -> Timer-Funktion stoppen
        if (!sockets.size) {
            clearInterval(timerId);
            timerId = null;
            console.log(`Timer stopped`);
        }

        let time = execSync('mocp -Q %ct');
        console.log(time.toString());

        let file = execSync('mocp -Q %file');
        console.log(file.toString());

        //durch Liste der Sockets gehen
        for (const s of sockets) {
            //Message an Socket schicken
            s.emit('send-file-message', file.toString());

            //Message an Socket schicken
            s.emit('send-time-message', time.toString());
        }
    }, 1000);
}

//Auf Port 8080 lauschen
http.listen(8080, () => {
    console.log('started on port 8080');
});