<?php
header('Access-Control-Allow-Origin: *');

//Bisherigen Prozess stoppen (Node und omxplayer)
exec('sudo /home/pi/mh_prog/VideoServer/stopnode.sh');

//Nochmal neu startn
exec('sudo /home/pi/mh_prog/VideoServer/startnode.sh');
?>