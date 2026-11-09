/* Central catalogue for optional personal modules. Keep presentation and persistence keyed by stable IDs. */
window.KxkoFeatureRegistry = Object.freeze([
  {id:"weather",name:"Weather",description:"Local conditions and forecasts",group:"daily",defaultEnabled:true,available:true},
  {id:"webuntis",name:"WebUntis",description:"Official personal school sign-in (school activation required)",group:"school",defaultEnabled:false,available:false},
  {id:"timetable",name:"Timetable",description:"Lessons, rooms and substitutions",group:"school",defaultEnabled:false,available:false},
  {id:"homework",name:"Homework",description:"Tasks and upcoming deadlines",group:"school",defaultEnabled:false,available:false},
  {id:"calendar",name:"Calendar",description:"Your upcoming Google Calendar events",group:"daily",defaultEnabled:false,available:true},
  {id:"briefing",name:"Daily Briefing",description:"A scheduled personal summary",group:"daily",defaultEnabled:true,available:false},
  {id:"cycling",name:"Cycling",description:"Ride tracking and live statistics",group:"activity",defaultEnabled:false,available:false},
  {id:"cycling_history",name:"Cycling history",description:"Past rides and route summaries",group:"activity",defaultEnabled:false,available:false},
  {id:"business",name:"Business tools",description:"Requests, reviews and site administration",group:"work",defaultEnabled:false},
  {id:"notifications",name:"Notifications",description:"Alerts and delivery preferences",group:"daily",defaultEnabled:true,available:false}
]);
