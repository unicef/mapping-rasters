// This script convterts a tif to asc format.
// node translate.js -f COL_ppp_v2b_2015_UNadj -r 25

var config = require('./config');
var store = config.rasterDir;
var ArgumentParser = require('argparse').ArgumentParser;
var parser = new ArgumentParser({
  version: '0.0.1',
  addHelp: true,
  description: 'Aggregate a csv of airport by admin 1 and 2'
});

parser.addArgument(
  ['-f', '--file'],
  {help: 'Name of tif file'}
);

parser.addArgument(
  ['-r', '--reduce_to_percent'],
  {help: 'Percent to reduce file, 25, for example'}
);

var args = parser.parseArgs();
var file = args.file || 'COL_ppp_v2b_2015_UNadj'
var reduce_percent = args.reduce_to_percent || 100;
console.log('Output file will be reduced to', reduce_percent+'%')
var exec = require('child_process').exec;
var command = 'gdal_translate -of AAIGrid  -outsize ' + reduce_percent + '% ' + reduce_percent + '% ' + store + file + '.tif ' + store + file + '.asc';
exec(command, (err, stdout, stderr) => {
  if (err) {
    console.error(err);
    return;
  }
  console.log(stdout);
});
