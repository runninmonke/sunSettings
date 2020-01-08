/*global $, google, ko, SunCalc*/
'use strict';

/* Maximum times a SunPlace will refine it's location */
var MAX_ATTEMPTS = 5;
/* Maximum error in ms allowed for estimate to be considered accurate */
var ESTIMATE_RANGE = 30000;

/* Units of time in milliseconds */
var SECOND = 1000;
var MINUTE = 60000; 
var HOUR = 3600000;
var DAY = 86400000;

/* Template used format data into infoWindow DOM elements */
var contentTemplate = {
	time: '<p>at %time%</p><p class="time-zone">%timezone%</p>',
	name: '<h3>%text%</h3>',
	weather: '<div class="cond-img" style="background-image: url(%url%);"></div>',
	start: '<div class="info-window">',
	end: '</div>'
};

/* Map marker icons images */
var icons = {
	standard: {url: 'imgs/default.png', pixelOffset:{width: 0, height: 0}},
	day: {url: 'imgs/day.png', pixelOffset:{width: 0, height: 16}},
	night: {url: 'imgs/night.png', pixelOffset:{width: 0, height: 0}},
	sunset: {url: 'imgs/sunset.png', pixelOffset:{width: 0, height: 16}},
	sunrise: {url: 'imgs/sunrise.png', pixelOffset:{width: 0, height: 16}},
	location: {url: 'imgs/location.png', anchor: {x: 16, y: 17}}
};

var GetRoute = function(origin, destination, callback) {
	var data = {
		origin: origin,
		destination: destination,
		travelMode: google.maps.TravelMode[vm.travelMode()]
	};
	
	directionsService.route(data, callback);
};


/*************************/
/****** Place Class ******/
/*************************/
var Place = function(data) {
	var self = this;

	self.address = ko.observable();
	self.latLng = ko.observable();
	self.active = ko.observable(true);
	self.hasSunDisplayTime = ko.observable(false);
	self.weather = ko.observable();
	self.status = 'deselected';
	this.timeZoneOffset = undefined;
	this.timeZoneName = undefined;
	self.content = '';
	self.icon = icons.standard;

	/* Assigns to observable if it exists, otherwise regular assignment */
	for (var item in data) {
		if (data.hasOwnProperty(item)) {
			self[item] ? self[item](data[item]) : self[item] = data[item];
		}
	}

	self.displayName = self.name[0].toUpperCase() + self.name.slice(1);
	self.time = new Date();
	self.displayTime = new Date();

	/* Deep copy template so object's infoWindow template content can be modified */
	self.template = {};
	for (item in contentTemplate) {
		if (contentTemplate.hasOwnProperty(item)) {
			self.template[item] = contentTemplate[item];
		}
	}

	self.draggable = false;
	self.infoWindow = new google.maps.InfoWindow({pixelOffset: self.icon.pixelOffset});

	/* Get missing address or LatLng and then additional data*/
	if (!self.latLng() && self.address()) {
		self.getGeocodeInfo();
	} else if (self.latLng() && !self.address()) {
		self.getGeocodeInfo();
		self.useLatLngForInfo();
	} else if (self.latLng()) {
		self.useLatLngForInfo();
	}
};

/* Reset LatLng dependent attributes with new Latlng */
Place.prototype.setLatLng = function(latLng) {
	this.reset();

	this.latLng(latLng);
	this.getGeocodeInfo();
	this.useLatLngForInfo();
};

/* Reset address dependent attributes with new address */
Place.prototype.setAddress = function(address) {
	this.reset();

	this.address(address);
	this.getGeocodeInfo();
};

Place.prototype.reset = function() {
	this.latLng(undefined);
	this.address(undefined);
	this.content = '';
	this.status = 'deselected';
	this.active(true);
	this.hasSunDisplayTime(false);
	this.weather('');
	this.timeZoneOffset = undefined;
	this.timeZoneName = undefined;
	this.status = 'deselected';
	this.content = '';

	if (this.marker) {
		this.marker.setMap(null);
		delete this.marker;		
	}
};

/* Populate properties with Geocoderesults */
Place.prototype.getGeocodeInfo = function() {
	var self = this;
	var data;

	if (self.latLng() && self.constructor != SunPlace) {
		data = {latLng: self.latLng()};
	} else if (self.address()) {
		data = {address: self.address()};
	} else {
		return;
	}

	/* Request geocoder info and then call all functions dependent on the results */
	geocoder.geocode(data, function(results, status) {
		if (status == 'OK') {
			self.address(results[0].formatted_address);
			if (!self.latLng()) {
				self.latLng(results[0].geometry.location);
				self.useLatLngForInfo();
			}
		} else if (status == 'OVER_QUERY_LIMIT') {
			setTimeout(function(){self.getGeocodeInfo();}, 1000);
		} else {
			alert('Location data unavailable:' + status);
		}
	});
};

/* Update dependencies of Latlng */
Place.prototype.useLatLngForInfo = function () {
	var self = this;

	self.latLngDisplay = self.latLng().lat().toString().slice(0,9);
	self.latLngDisplay += ', ' + self.latLng().lng().toString().slice(0,9);

	self.getWeatherData();

	/* Run methods dependent on time, but don't change time */
	self.createTime();

	if (self.marker) {
		self.marker.setPosition(self.latLng());
	} else {
		self.createMarker();
	}
};

/* Get locale weather data */
Place.prototype.getWeatherData = function() {
	var self = this;

	if (this.constructor == SunPlace && !this.finalized) {
		return;
	}

	self.weatherData = 'Loading';
	self.getWeather();

	/* Use an API to get weather info*/
	$.getJSON(`https://api.weather.gov/points/${self.latLng().lat() + ',' + self.latLng().lng()}/forecast/hourly`, function(results) {
		if (!results) {
			self.weatherData = 'Unavailable';
			self.getWeather();
		}
		self.weatherData = results.properties;

		/* Determine amount API times are offset from UTC. Assumes time offset will be some increment of 30 minutes */
		self.weatherData.startTime = new Date(self.weatherData.periods[0].startTime);
		self.getWeather();
	}).fail(function() {
		self.weatherData = 'Unavailable';
		self.getWeather();
	});
};

/* Find weather data for current time of place */
Place.prototype.getWeather = function() {
	if (typeof(this.weatherData) === 'string') {
		this.weather(this.weatherData);
		return;
	}

	var placeTimeVsForecastStart = this.time.getTime() - this.weatherData.startTime.getTime();

	if (placeTimeVsForecastStart < -HOUR) {
		this.weather('');
	} else if (placeTimeVsForecastStart < HOUR/2){
		this.weather(this.weatherData.periods[0]);
	} else if (placeTimeVsForecastStart < (7 * DAY)) {
		var forecastHour = Math.round(placeTimeVsForecastStart/HOUR);
		this.weather(this.weatherData.periods[forecastHour]);
	} else {
		this.weather('');
	}

	this.buildContent();
};

/* Calculate local sun times */
Place.prototype.getSunTimes = function() {
	this.sun = SunCalc.getTimes(this.time, this.latLng().lat(), this.latLng().lng());
	
	/* Set to false because time zone info display time isn't parsed until buildContent is called */
	this.hasSunDisplayTime(false);
};

/* Get locale timezone information */
Place.prototype.getTimeZone = function() {
	var self = this;
	var url = `https://maps.googleapis.com/maps/api/timezone/json?location=${self.latLng().lat()},${self.latLng().lng()}&timestamp=${self.time.getTime()/1000}&key=${KEYS.TIMEZONE}`;

	$.getJSON(url, function(results){
		if (results.status == 'OK') {
			self.timeZoneName = results.timeZoneName;
			self.timeZoneOffset = (results.rawOffset + results.dstOffset) / 60;
		} else {
			self.timeZoneName = 'Coordinated Universal Time';
			self.timeZoneOffset = 0;
		}
		self.buildContent();
	});

	/* Also getWeather update if weatherData is available */
	if (this.hasOwnProperty('weatherData')) {
		this.getWeather();
	}
};

/* Use to set time of place object. Makes sure dependies of time also change. */
Place.prototype.createTime = function(newTime) {
	newTime = newTime || this.time.getTime();
	
	var newTimeObj = new Date(newTime);
	var timeDif = Math.abs(newTime - this.time.getTime());
	var isNewHour = this.time.getHours() == newTimeObj.getHours() ? false : true;

	this.time.setTime(newTime);

	if (this.latLng()) {
		/* Only get time zone info when call doesn't change time (initial call) or when hour changes */
		if (timeDif == 0 || timeDif >= HOUR || isNewHour) {
			this.getTimeZone();
		}
		this.getSunTimes();
		this.buildContent();
	}
};

// Return a date object where the UTC time is actually the local timezone time.
// Also includes a formatted string of the time as property.
Place.prototype.getDisplayTime = function(time = false) {
	console.log('time!', time)
	if (!time) {
		time = this.time;
	}

	var userTimezoneDiff = this.timeZoneOffset + time.getTimezoneOffset();
	var displayTime = new Date(time.getTime() + (userTimezoneDiff * 3600000));
	displayTime.meridie = 'AM';
	displayTime.hours = displayTime.getHours();
	displayTime.minutes = displayTime.getMinutes().toString();
	displayTime.seconds = displayTime.getSeconds().toString();
	console.log(this.name, displayTime.hours, this.time);

	if (displayTime.hours > 12) {
		displayTime.meridie = 'PM';
		displayTime.hours = displayTime.hours - 12;
	} else if (displayTime.hours == 12) {
		displayTime.meridie = 'PM';
	} else if (displayTime.hours == 0) {
		displayTime.hours = '12';
	}

	if (displayTime.minutes.length < 2) {
		displayTime.minutes = '0' + displayTime.minutes;
	}

	if (displayTime.seconds.length < 2) {
		displayTime.seconds = '0' + displayTime.seconds;
	}

	displayTime.string = `${displayTime.hours}:${displayTime.minutes}:${displayTime.seconds} ${displayTime.meridie}`;
	return displayTime;
};

Place.prototype.findTimeFromLocal = function(time) {
	var userTimezoneDiff = this.timeZoneOffset - time.getTimezoneOffset();
	return new Date(time.getTime() + (userTimezoneDiff * 3600000));
};

/* Check for what data has been successfully retrieved and build content for infoWindow by plugging it into the template */
Place.prototype.buildContent = function() {
	this.displayTime = this.getDisplayTime();

	for (var item in this.sun) {
		if (this.sun.hasOwnProperty(item)) {
			this.sun[item].displayTime = this.getDisplayTime(this.sun[item]).string;
		}
	}

	this.content = this.template.start;
	this.content += this.template.name.replace('%text%', this.displayName);

	if (this.constructor != Waypoint) {
		if (this.weather() && typeof(this.weather()) !== 'string') {
			this.content += this.template.weather.replace('%url%', this.weather().icon);
		} else if (this.finalized) {
			this.content += this.template.weather.replace('%url%', 'imgs/no-weather.png');
		}
	}

	this.content += this.template.time.replace('%time%', this.displayTime.string).replace('%timezone%', this.timeZoneName);
	this.content += this.template.end;

	if (!icons.hasOwnProperty(this.name)) {
		if (this.time.getTime() > this.sun.sunset.getTime() || this.time.getTime() < this.sun.sunrise.getTime()) {
			this.icon = icons.night;
		} else {
			this.icon = icons.day;
		}
	}

	this.infoWindow.setContent(this.content);
	this.infoWindow.setOptions({pixelOffset: this.icon.pixelOffset});
	if (this.hasOwnProperty('marker')) {
		this.marker.setOptions({icon: this.icon});
	}

	if (!this.hasSunDisplayTime()) {
		this.hasSunDisplayTime(true);
	}
};

/* Use latLng data to create map marker */
Place.prototype.createMarker = function() {
	var self = this;

	/* Create map marker */
	self.marker = new google.maps.Marker({
		position: self.latLng(),
		map: map,
		title: self.displayName,
		draggable: self.draggable,
		icon: self.icon.icon
	});

	/* Remove marker from map if place not active otherwise set selected to display marker */
	if (!self.active()) {
		self.marker.setMap(null);
	} else if (self.status == 'deselected') {
		self.toggleSelected();
	}

	/* Allow selected to toggle by clicking map marker */
	self.marker.addListener('click', function() {
		self.toggleSelected();
	});

	/* Allow user to change place/route by dragging marker */
	self.marker.addListener('dragend', function(evt) {
		self.setLatLng(evt.latLng);
	});

};

Place.prototype.toggleSelected = function() {
	if (this.status =='selected') {
		this.status ='deselected';
		this.infoWindow.close();
	} else {
		this.status = 'selected';
		if (this.hasOwnProperty('marker')) {
			this.infoWindow.open(map, this.marker);
		}
	}
};

/****************************/
/****** Waypoint Class ******/
/****************************/

var Waypoint = function(data) {
	var self = this;

	Place.call(self, data);

		/* Display latLng if no address */
	self.displayRead = ko.computed({
		read: function() {
			/* Display address if available */
			if (this.address) {
				return self.address();
			} else if (self.latLngDisplay) {
				return self.latLngDisplay;
			}
		},
		write: function(){
		},
		owner: this
	});

	self.displayWrite = ko.computed({
		read: function() {
		},
		write: function(){
			self.setAddress($('.' + self.name + ' .field').val());
		},
		owner: this
	});

	self.keyHandler = function(data, evt) {
		if (evt.keyCode == 13) {
			self.setAddress(evt.target.value);
		}

		return true;
	};

	self.draggable = true;
	/* Make sure marker is draggable in case creation is already complete */
	if (self.hasOwnProperty('marker')) {
		self.marker.setOptions({
			draggable: this.draggable
		});
	}

	self.setMapCenter = ko.computed(function() {
		map.setCenter(self.latLng());
	});
};

Waypoint.prototype = Object.create(Place.prototype);
Waypoint.prototype.constructor = Waypoint;


/****************************/
/****** SunPlace Class ******/
/****************************/

var SunPlace = function(data) {
	Place.call(this, data);

	this.template.time = '<p>Locating...</p>';
	this.refineAttemps = 0;
	
	this.icon = icons[this.name];
	this.finalized = false;
};

SunPlace.prototype = Object.create(Place.prototype);
SunPlace.prototype.constructor = SunPlace;

SunPlace.prototype.finalize = function() {
	this.template.time = contentTemplate.time;
	this.setLatLng(this.latLng());
	this.toggleSelected();
	this.finalized = true;
	this.getWeatherData();

	vm.journey().finalize();
};

/* Adjusts location/time of self to match estimated travel time with sun event time */
SunPlace.prototype.refineEstimate = function(pathSection, startTime) {
	var self = this;
	self.refineAttemps++;

	/* Esimate location of sun event along path */
	var eventLocationEstimate;
	var previousEstimate = -2;
	while(true) {
		eventLocationEstimate = (self.time.getTime() - startTime) / (pathSection.duration.value * vm.paceMultiplier());
		eventLocationEstimate = Math.round(pathSection.path.length * eventLocationEstimate);

		/* Make sure estimated sun time doesn't leave path range */
		if (eventLocationEstimate < 0) {
			eventLocationEstimate = 0;
		} else if (eventLocationEstimate > pathSection.path.length - 1) {
			eventLocationEstimate = pathSection.path.length - 1;
		}

		/* Exit loop once best guess of location has become consistent */
		if (Math.abs(previousEstimate - eventLocationEstimate) < 2) {
			break;
		}

		if (self.refineAttemps == 1) {
			self.setLatLng(pathSection.path[eventLocationEstimate]);
		} else {
			self.latLng(pathSection.path[eventLocationEstimate]);
			self.getSunTimes();
		}

		self.createTime(self.sun[self.name].getTime());
		
		previousEstimate = eventLocationEstimate;
	}

	var directionsCallback = function(result, status) {
		if (status == 'OK') {
			var steps = result.routes[0].legs[0].steps;
			
			/* Deep copy utilized attributes since values change in the case of a multi-step result*/
			var newPathSection = {duration: {}, path: []};
			newPathSection.duration.value = steps[0].duration.value;
			newPathSection.path = steps[0].path.slice();


			/* Include all steps if multiple were included */
			for (var i = 1; i < steps.length; i++) {
				newPathSection.duration.value += steps[i].duration.value;
				for (var j = 0; j < steps[i].path.length; j++) {
					newPathSection.path.push(steps[i].path[j]);
				}
			}

			var arrivalTime = startTime + newPathSection.duration.value * vm.paceMultiplier();
			self.estimateError = self.time.getTime() - arrivalTime;
			if (self.estimateError > ESTIMATE_RANGE) {
				newPathSection.path = pathSection.path.slice(eventLocationEstimate);
				newPathSection.duration.value = pathSection.duration.value - newPathSection.duration.value;
				self.refineEstimate(newPathSection, arrivalTime);
			} else if (self.estimateError < -ESTIMATE_RANGE) {
				self.refineEstimate(newPathSection, startTime);
			} else {
				self.finalize();
			}
		} else if (status == 'OVER_QUERY_LIMIT') {
			setTimeout(function() {GetRoute(pathSection.path[0], self.latLng(), directionsCallback);}, 1000);
		} else {
			alert('Directions unavailable: ' + status);
		}
	};

	if (self.refineAttemps <= MAX_ATTEMPTS) {
		GetRoute(pathSection.path[0], self.latLng(), directionsCallback);
	} else {
		self.finalize();
	}
};

/* Finds the next sun event that will occur */
function findNextSunEvent (lastSunTime, sunTimes, latLng) {
	var nextSunEvent = {
		time: new Date(lastSunTime),
		sun: sunTimes,
		latLng: latLng
	};
	var potentialTimes = [];
	var eventsOfInterest = ['sunrise', 'sunset'];

	/* Check for sun events that have yet to occur */
	for (var i = 0; i < eventsOfInterest.length; i++) {
		if (sunTimes[eventsOfInterest[i]].getTime() > lastSunTime) {
			potentialTimes.push({time: sunTimes[eventsOfInterest[i]], name: eventsOfInterest[i]});
		}
	}

	/* Find sun event yet to occur that will occur soonest */
	var minTime = 99999999999999;
	var iTime;

	for (var j = 0; j < potentialTimes.length; j++) {
		iTime = potentialTimes[j].time.getTime();
		if (iTime < minTime) {
			minTime = iTime;
			nextSunEvent.time.setTime(iTime);
			nextSunEvent.name = potentialTimes[j].name;
		}
	}

	/* If no result, add 24 hours to the time the sun events are calculated from and re-try */
	if (!nextSunEvent.hasOwnProperty('name')) {
		var oneDayLater = new Date(nextSunEvent.time.getTime() + 86400000);
		nextSunEvent.sun = SunCalc.getTimes(oneDayLater, latLng.lat(), latLng.lng());
		nextSunEvent = findNextSunEvent(nextSunEvent.time.getTime(), nextSunEvent.sun, latLng);
	}

	return nextSunEvent;
}


/***************************/
/****** Journey Class ******/
/***************************/
var Journey = function(start, finish) {
	this.startPlace = start;
	this.finishPlace = finish;
	this.sunEvents = [];
	this.sunlightChange = ko.observable();
	this.duration = ko.observable();
	this.distance = ko.observable();
};

Journey.prototype.loadRoute = function(route) {
	this.route = route;
	this.route.notFromDrag = true;

	directionsDisplay.set('directions', null);
	directionsDisplay.setDirections(route);

	this.duration(this.route.routes[0].legs[0].duration.value * vm.paceMultiplier());
	this.distance(this.route.routes[0].legs[0].distance.value);

	this.finishPlace().createTime(this.startPlace().time.getTime() + this.duration());

	this.analyzeRoute();
};

Journey.prototype.resetSunEvents = function() {
	if (this.sunEvents) {
		for (var i = 0; i < this.sunEvents.length; i++) {
			this.sunEvents[i].reset();
		}
		this.sunEvents = [];
	}
};

/* Finds location/time of sun events during journey */
Journey.prototype.analyzeRoute = function() {
	var self = this;
	var locationTime = this.startPlace().time.getTime();
	var nextLocationTime = locationTime;
	var nextSunEventTime;

	var path = this.route.routes[0].legs[0].steps;
	var sunEvent = {time: new Date(locationTime)};
	sunEvent.sun = SunCalc.getTimes(sunEvent.time, path[0].start_location.lat(), path[0].start_location.lng());

	self.resetSunEvents();

	
	/* Find next sun event on path and repeat until end of path is reached */
	var reachEnd;
	while(path.length > 0) {

		sunEvent = findNextSunEvent(sunEvent.time.getTime(), sunEvent.sun, path[0].start_location);

		/* Update sunTimes if have progressed to next day */
		if (sunEvent.hasOwnProperty('nextDayTimes')) {
			sunEvent.sun = sunEvent.nextDayTimes;
		}

		/* Check each section of path until next sun event time is reached */
		reachEnd = true;
		for (var i = 0; i < path.length; i++) {
			nextLocationTime = locationTime + (path[i].duration.value * vm.paceMultiplier());
			nextSunEventTime = SunCalc.getTimes(sunEvent.time, path[i].end_location.lat(), path[i].end_location.lng())[sunEvent.name].getTime();

			/* Set values for next iteration if no sun event occurs during current section. Otherwise create Place object for sunEvent */
			if (nextSunEventTime > nextLocationTime) {
				locationTime = nextLocationTime;

				sunEvent.time.setTime(nextSunEventTime);
				sunEvent.sun = SunCalc.getTimes(sunEvent.time, path[i].end_location.lat(), path[i].end_location.lng());
			} else {
				/* Conditional necessary to make sure we are using a sun event time that will occur during the travel time of the current section */
				if (sunEvent.time.getTime() > nextLocationTime) {
					sunEvent.time.setTime(nextSunEventTime);
					sunEvent.sun = SunCalc.getTimes(sunEvent.time, path[i].end_location.lat(), path[i].end_location.lng());
				}

				/* Create sun event and call the estimation of its location*/
				var newSunEventPlace = new SunPlace({name: sunEvent.name}); 
				newSunEventPlace.createTime(sunEvent.time.getTime());
				self.sunEvents.push(newSunEventPlace);
				newSunEventPlace.refineEstimate(path[i], locationTime);

				/* Remove path that has already been checked before next iteration */
				path = path.slice(i);
				reachEnd = false;
				break;
			}
		}

		if (reachEnd) {
			if (self.sunEvents.length == 0) {
				self.finalize();
			}

			break;
		}
	}
};


/* Main purpose is to calculate the diffence in daylight that is experienced on the journey vs staying at the departure location */
Journey.prototype.finalize = function() {
	/* Stop if all sunEvents are not finalized */
	for (var i = 0; i < this.sunEvents.length; i++) {
		if (!this.sunEvents[i].finalized) {
			return;
		}
	}

	/* Initialize objects for summing sunlight during journey for comparison */
	var journeyPlaceAnalysis = {sunlight: 0, 
		time: vm.startPlace().time.getTime()
	};
	var departurePlaceAnalysis = {sunlight: 0, 
		time: journeyPlaceAnalysis.time,
		sun: vm.startPlace().sun
	};

	/* Object that will be updated with sunEvent info of the events that occur at the departure place during the journey */
	var departurePlaceEvent = {sun: vm.startPlace().sun, 
		latLng: vm.startPlace().latLng()
	};

	/* Sum amount of sunlight during journey */
	for (var j = 0; j < this.sunEvents.length; j++) {
		if (this.sunEvents[j].name == 'sunset') {
			journeyPlaceAnalysis.sunlight += this.sunEvents[j].time.getTime() - journeyPlaceAnalysis.time;
		} 
		journeyPlaceAnalysis.time = this.sunEvents[j].time.getTime();

		departurePlaceEvent = findNextSunEvent(departurePlaceAnalysis.time, departurePlaceEvent.sun, departurePlaceEvent.latLng );
		
		if (departurePlaceEvent.name == 'sunset') {
			departurePlaceAnalysis.sunlight += departurePlaceEvent.time - departurePlaceAnalysis.time;
		}
		departurePlaceAnalysis.time = departurePlaceEvent.time;
	}

	/* Include remaining sunlight left in the day after arrival */
	departurePlaceEvent = findNextSunEvent(departurePlaceAnalysis.time, departurePlaceEvent.sun, departurePlaceEvent.latLng );
	if (departurePlaceEvent.name == 'sunset') {
		departurePlaceAnalysis.sunlight += departurePlaceEvent.time - departurePlaceAnalysis.time;
	}

	var arrivalPlaceEvent = findNextSunEvent(vm.finishPlace().time.getTime(), vm.finishPlace().sun, vm.finishPlace().latLng());
	if (arrivalPlaceEvent.name == 'sunset') {
		journeyPlaceAnalysis.sunlight += arrivalPlaceEvent.time - journeyPlaceAnalysis.time;
	}

	this.sunlightChange(journeyPlaceAnalysis.sunlight - departurePlaceAnalysis.sunlight);

	/* Now allow for journey to be changed */
	this.finalized = true;
};

function getDurationString(time) {
	var negSign = '';

	if (time < 0) {
		time = time * -1;
		negSign = '-';
	}

	var hours = Math.floor(time/HOUR);
	var minutes = Math.floor(time/MINUTE) % 60;
	var seconds = Math.floor(time/SECOND) % 60;

	minutes = minutes.toString();
	seconds = seconds.toString();

	if (minutes.length < 2) {
		minutes = '0' + minutes;
	}

	if (seconds.length < 2) {
		seconds = '0' + seconds;
	}

	var displayString = negSign + ' ' + hours + ':' + minutes + ':' + seconds;
	return displayString;
}

/************************/
/****** View Model ******/
/************************/
var viewModel = function() {
	vm = this;
	vm.startPlace = ko.observable(new Waypoint({name: 'departure'}));
	vm.finishPlace = ko.observable(new Waypoint({name: 'arrival'}));
	vm.journey = ko.observable();
	vm.departureTime = ko.observable();
	vm.travelMode = ko.observable('DRIVING');
	vm.paceMultiplier = ko.observable(1000);

	/* Increase map zoom level on large displays */
	if (window.matchMedia('(min-width: 700px)').matches) {
		map.setZoom(12);
	}

	vm.showAlert = ko.observable(true);

	vm.inputStart = function() {
		vm.startPlace(new Waypoint({name: 'start', address: $('.alert-window .field').val()}));

		$('.start-container').toggleClass('hidden', true);
		vm.showAlert(false);

		/* Re-bind autocomplete functionality otherwise Knockout interupts it*/
		autocompleteStart = new google.maps.places.Autocomplete($('.start .field')[0]);
		autocompleteStart.bindTo('bounds', map);
		$('.arrival input').focus();
	};

	/* Callback for geolocation of intial start position */
	vm.getStartLocation = function(position) {
		if (position) {
			var latLng = new google.maps.LatLng(position.coords.latitude, position.coords.longitude);
				
			vm.startPlace().setLatLng(latLng);
			$('.start-container').toggleClass('hidden', true);
			vm.showAlert(false);
		}
	};

	if (navigator.geolocation) {
		navigator.geolocation.getCurrentPosition(vm.getStartLocation);
		$('.arrival input').focus();
	} else {
		alert('Browser not supported');
	}

	/* Submit position of geoMarker for starting location */
	vm.submitGeolocation = function() {
		var newPosition = {coords:{}};
		newPosition.coords.latitude = geoMarker.getPosition().lat();
		newPosition.coords.longitude = geoMarker.getPosition().lng();
		vm.getStartLocation(newPosition);
	};

	/* Toggle menu nav-bar open and closed */
	vm.toggleMenu = function(evt, obj, actionCase) {
		actionCase = actionCase || vm.menuStatus();

		if (actionCase == 'closed') {
			vm.menuStatus('open');
			$('.icon').text('<');
		} else {
			vm.menuStatus('closed');
			$('.icon').text('>');
		}
	};


	vm.menuStatus = ko.observable('closed');
	vm.toggleMenu();

	vm.travelModeClick = function(obj, evt) {
		if (evt.target.id != 'locate') {
			vm.travelMode(evt.target.value);
            vm.paceMultiplier(1000);

			var locateStatus = $('#locate')[0].className;

			$('.travel-mode > button').attr('class', '');
			evt.target.className = 'selected';
			$('#locate')[0].className = locateStatus;
		}
	};


	vm.toggleGeoMarker = function() {
		$('#locate').toggleClass('selected');

		if ($('#locate')[0].className == 'selected') {
			$('.departure .submit').toggleClass('hidden', true);
			$('.geo-submit').toggleClass('hidden', false);

			geoMarker.setMap(map);
			map.setZoom(15);
		} else {
			geoMarker.setMap(null);
			$('.departure .submit').toggleClass('hidden', false);
			$('.geo-submit').toggleClass('hidden', true);
		}
	};

	vm.reset = function() {
		vm.finishPlace().reset();
		vm.journey().resetSunEvents();
		vm.journey(undefined);
		vm.paceMultiplier(1000);
		directionsDisplay.set('directions', null);
		map.setCenter(vm.startPlace().latLng());
		map.set('disableDoubleClickZoom', true);

		$('.reset').toggleClass('hidden', true);
		$('.return-trip').toggleClass('hidden', true);
		$('.arrival .set-time').toggleClass('hidden', true);
		$('.tabs :first').click();
		vm.hidePaceSettings();
	};

	/* Bring up alert window to change time */
	vm.showTimeSettings = function() {
		$('.message').text(this.displayName);
		$('.alert-window').css('width', '210px');
		$('.alert-window').css('min-width', '210px');
		$('.time-container').toggleClass('hidden', false);

		$('.month').val(this.displayTime.getMonth() + 1);
		$('.day').val(this.displayTime.getDate());
		$('.year').val(this.displayTime.getFullYear());

		$('.hours').val(this.displayTime.hours);
		$('.minutes').val(this.displayTime.minutes);
		$('.seconds').val(this.displayTime.seconds);

		$('.meridies').val(this.displayTime.meridie);

		$('.alert-window .submit').off();

		if (this.name == 'arrival') {
			$('.alert-window .cancel').toggleClass('hidden', false);
			$('.alert-window .current').toggleClass('hidden', true);
			$('.alert-window .submit').click(vm.setArrivalTime);
		} else if (this.name == 'departure') {
			$('.alert-window .cancel').toggleClass('hidden', true);
			$('.alert-window .current').toggleClass('hidden', false);
			$('.alert-window .submit').click(vm.setDepartureTime);
		} else {
			alert('Error: Invlid place for time setting');
		}

		vm.showAlert(true);
		$('.time-container input').eq(0).focus();
	};

	/* Read input into new Date object */
	vm.getNewTime = function() {
		var newHours = $('.hours').val();
		if ($('.meridies').val() == 'PM' && newHours < 12) {
			newHours = newHours * 1 + 12;
		} else if ($('.meridies').val() == 'AM' && newHours == 12) {
			newHours = 0;
		}

		var newMonth = $('.month').val() - 1;

		return new Date($('.year').val(), newMonth, $('.day').val(), newHours, $('.minutes').val(), $('.seconds').val());
	};

	// TODO: Add error handling.
	vm.setDepartureTime = function() {
		var newTime = vm.getNewTime();
		var oldTime = vm.journey() ? vm.journey().startPlace().displayTime : new Date(0);

		if (
			Math.abs(oldTime.valueOf() - newTime.valueOf()) >= 2000
			|| oldTime.getSeconds() !== newTime.getSeconds()
		) {
			newTime.setTime(newTime.getTime() + (-1 * vm.startPlace().timeZoneOffset));
			vm.departureTime(newTime);
			vm.startPlace().createTime(newTime.getTime());
		}

		$('.time-container').toggleClass('hidden', true);
		vm.showAlert(false);
		$('.departure .set-time').focus();
	};

	/* Use current time for next departure time */
	vm.removeDepartureTime = function() {
		// Use different falsey value from initialization to ensure changes are registered.
		vm.departureTime(false);
		vm.timer();
		vm.showAlert(false);
		$('.set-time').focus();
	};


	vm.setArrivalTime = function() {
		var newTime = vm.getNewTime();
		var oldTime = vm.journey() ? vm.journey().finishPlace().displayTime : new Date(0);

		if (
			Math.abs(oldTime.valueOf() - newTime.valueOf()) >= 2000
			|| oldTime.getSeconds() !== newTime.getSeconds()
		) {
			newTime.setTime(newTime.getTime() + (-1 * vm.finishPlace().timeZoneOffset));
			var newPace = (newTime.getTime() - vm.startPlace().time.getTime()) / vm.journey().duration();
			newPace = newPace * vm.paceMultiplier();
			vm.changePace({}, {}, newPace);
		}

		$('.time-container').toggleClass('hidden', true);
		vm.showAlert(false);
		$('.arrival .set-time').focus();
	};

	/* UI for changing travel speed */
	vm.showPaceSettings = function() {
		$('.pace .data').attr('style', 'display: none');
		$('.pace input').toggleClass('hidden', false).focus();
		$('.pace input')[0].value = vm.formattedPace;
		$('.pace input')[0].setSelectionRange(0, 999);
		$('.show-set-pace').toggleClass('hidden', true);
		$('.set-pace').toggleClass('hidden', false);
	};

	vm.hidePaceSettings = function() {
		$('.pace .data').attr('style', '');
		$('.pace input').toggleClass('hidden', true);
		$('.show-set-pace').toggleClass('hidden', false);
		$('.set-pace').toggleClass('hidden', true);
	};

	vm.resetPace = function() {
		vm.paceMultiplier(1000);
		vm.hidePaceSettings();
	};

	/* Change travel speed */
	vm.changePace = function(obj, evt, newPace) {
		newPace = newPace || vm.paceMph / $('.pace input')[0].value * vm.paceMultiplier();
		vm.paceMultiplier(newPace);
		vm.hidePaceSettings;
	};

	vm.cancelTime = function() {
		vm.showAlert(false);
	};

	/* Use current arrival time for departure time and reverse the route */
	vm.getReturnTrip = function() {
		var newFinishLatLng = new google.maps.LatLng({lat: vm.startPlace().latLng().lat(), lng: vm.startPlace().latLng().lng()});
		var newStartLatLng = new google.maps.LatLng({lat: vm.finishPlace().latLng().lat(), lng: vm.finishPlace().latLng().lng()});
		vm.departureTime(new Date(vm.finishPlace().time.getTime()));
		
		vm.startPlace().reset();
		vm.finishPlace().reset();

		vm.startPlace().setLatLng(newStartLatLng);
		vm.startPlace().createTime(vm.departureTime().getTime());
		vm.finishPlace().setLatLng(newFinishLatLng);
	};

	/* Updates startPlace time when running so current time */
	vm.timer = function() {
		if (!vm.departureTime() && !vm.journey()) {
			vm.startPlace().createTime(Date.now());
			setTimeout(vm.timer, 1000);
		}
	};

	vm.timer();

	vm.directionsCallback = function(result, status) {
		if (status == google.maps.DirectionsStatus.OK) {
			vm.journey().loadRoute(result);		
		} else {
			alert('Directions unavailable: ' + status);
			if (vm.journey().route) {
				delete vm.journey().route;
				directionsDisplay.set('directions', null);
			}
		}
	};

	/* Loads new route when Google LatLng objects are loaded for both start and finish places */
	vm.getJourney = ko.computed(function() {
		/* Some parts of conditional are only present to make KO trigger function when the variables involved change */
		if (
        vm.startPlace().latLng()
        && vm.finishPlace().latLng()
        && vm.paceMultiplier()
        && vm.travelMode()
        && (!vm.journey() || vm.journey().finalized)
    ) {
			if (vm.journey()) {
				vm.journey().resetSunEvents();
				vm.journey().finalized = false;
			}

			if (!vm.departureTime()) {
				vm.startPlace().createTime(Date.now());
			}

			vm.journey(new Journey(vm.startPlace, vm.finishPlace));

			GetRoute(vm.startPlace().latLng(), vm.finishPlace().latLng(), vm.directionsCallback);
			
			$('.reset').toggleClass('hidden', false);
			$('.return-trip').toggleClass('hidden', false);
			$('.arrival .set-time').toggleClass('hidden', false);
			vm.hidePaceSettings();

			/* Make sure startPlace is deselected to hide infoWindow */
			vm.startPlace().status = 'selected';
			vm.startPlace().toggleSelected();
		}
	});


	/* Listens for route drag events and reloads route */
	directionsDisplay.addListener('directions_changed', function() {
		var directionsRoute = directionsDisplay.getDirections();

		if (directionsRoute && !directionsRoute.hasOwnProperty('notFromDrag')) {
			vm.journey().loadRoute(directionsRoute);
		}
	});

	/* Use double click event to create destination if not present */
	map.addListener('dblclick', function(evt) {
		if (!vm.finishPlace().latLng()) {
			vm.finishPlace().setLatLng(evt.latLng);
			map.set('disableDoubleClickZoom', false);
		}
	});

	vm.selectedTab = ko.observable(vm.startPlace());

	vm.tabClick = function(obj, evt) {
		var tab = evt.target.textContent;
		if ((tab == 'Finish' && !vm.finishPlace().latLng()) || (tab == 'Trip' && !vm.journey()) || evt.target.className == 'tabs row') {
			return;
		}

		$('.tabs div').attr('class', 'deselected');
		evt.target.className = 'selected';

		if (tab == 'Trip') {
			$('.places'). toggleClass('hidden', true);
			$('.journey').toggleClass('hidden', false);
			return;
		} else if (tab == 'Start') {
			vm.selectedTab(vm.startPlace());
		} else if (tab == 'Finish') {
			vm.selectedTab(vm.finishPlace());
		}

		$('.places'). toggleClass('hidden', false);
		$('.journey').toggleClass('hidden', true);		
	};

	vm.showPlace = ko.pureComputed(function() {
		if (vm.selectedTab().hasSunDisplayTime()) {
			return true;
		}
	});
	
	vm.selectedSunrise = ko.pureComputed(function() {
		if (vm.selectedTab().hasSunDisplayTime()) {
			return vm.selectedTab().getDisplayTime(vm.selectedTab().sun.sunrise).string;
		}
	});

	vm.selectedSunset = ko.pureComputed(function() {
		if (vm.selectedTab().hasSunDisplayTime()) {
			return vm.selectedTab().getDisplayTime(vm.selectedTab().sun.sunset).string;
		}
	});

	vm.dayLength = ko.pureComputed(function() {
		if (vm.selectedTab().hasSunDisplayTime()) {
			return getDurationString(vm.selectedTab().sun.sunset.getTime() - vm.selectedTab().sun.sunrise.getTime());
		}
	});

	vm.showWeather = ko.pureComputed(function(){
		vm.displayWeather(vm.selectedTab().weather());
		return true;
	});


	/* Display information for travel tab */
	vm.daylightChangeDisplay = ko.pureComputed(function() {
		if (vm.journey() && $.isNumeric(vm.journey().sunlightChange())) {
			/* Show travel info when changes */
			$('.tabs :last').click();

			return getDurationString(vm.journey().sunlightChange());
		}
	});
	vm.distanceDisplay = ko.pureComputed(function() {
		if (vm.journey() && vm.journey().distance()) {
			return Math.round(vm.journey().distance() * 0.000621371192) + ' miles';
		}
	});
	vm.durationDisplay = ko.pureComputed(function() {
		if (vm.journey() && vm.journey().duration()) {
			return getDurationString(vm.journey().duration());
		}
	});
	vm.paceDisplay = ko.pureComputed(function() {
		if (vm.journey() && vm.journey().distance()) {
			vm.paceMph = (vm.journey().distance() / vm.journey().duration()) * 2236.94;
			vm.formattedPace = (Math.round(vm.paceMph * 100) / 100);
			return vm.formattedPace + ' mph';
		}
	});

	/* Variables for weather section display */
	vm.conditionImg = ko.observable('none');
	vm.currentCondition = ko.observable('');
	vm.currentTemp = ko.observable('');

	/* Display local weather in nav bar */
	vm.displayWeather = function(weather) {
		if (!weather) {
			weather = '';
		}

		if (typeof(weather) === 'string') {
			vm.conditionImg('none');
			vm.currentCondition(weather);
			vm.currentTemp('');
		} else {
			vm.conditionImg(`url(${weather.icon})`);
			vm.currentCondition(weather.shortForecast);
			vm.currentTemp(weather.temperature + '°' + weather.temperatureUnit);
		}
	};

	var autocompleteStart = new google.maps.places.Autocomplete($('.departure .field')[0]);
	var autocompleteFinish = new google.maps.places.Autocomplete($('.arrival .field')[0]);
	var autocompleteAlert = new google.maps.places.Autocomplete($('.alert-window .field')[0]);
	
	autocompleteStart.bindTo('bounds', map);
	autocompleteFinish.bindTo('bounds', map);

	/* Handle bicycle layer manually as the Google directionsRender was inconsistent */
	var bikeLayer = new google.maps.BicyclingLayer();
	vm.showBikeLayer = ko.computed(function() {
		if (vm.travelMode() == 'BICYCLING') {
			bikeLayer.setMap(map);
		} else {
			bikeLayer.setMap(null);
		}
	});
	
	/* Deal with iPhone 4 display bug that arrises otherwise */
	autocompleteFinish.addListener('place_changed', function() {
		$('.departure .field').focus();
		$('.departure .field').blur();
	});

	/* Select input text on focus */
	$('body').on('focus', 'input', function(evt) {
		evt.target.setSelectionRange(0, 999);
	});

	/* Manually implement focus event actions on click for browsers that don't fire it */
	$('body').on('mouseenter', 'input', function() {
		setTimeout(function() {
			if (!(vm.focusedElement == document.activeElement)) {
				vm.focusedElement = document.activeElement;
				if (document.activeElement.hasOwnProperty('setSelectionRange')) {
					document.activeElement.setSelectionRange(0, 999);
				}
			}
		}, 50);
	});

	$(function() {
		$('.alert-window .field').focus();
		// Listener to deal with body overflow that occurs on iPhone 4 in lanscape orientation.
		window.addEventListener('scroll', function(){
			var mq = window.matchMedia('only screen and (max-device-width: 600px) and (orientation: landscape)');
			if (mq.matches && !vm.showAlert()) {
				window.scrollTo(0, 0);
			}
		});
	});

	/* Hide menus on small screens when in landscape orientation */
	vm.orientationDisplayAdjust = function() {
		var mq = window.matchMedia('only screen and (max-device-width: 600px) and (orientation: landscape)');
		if (mq.matches) {
			$('#nav-bar').toggleClass('hidden', true);
			$('#hamburger').toggleClass('hidden', true);
		} else {
			$('#nav-bar').toggleClass('hidden', false);
			$('#hamburger').toggleClass('hidden', false);
		}
	};

	window.addEventListener('resize', vm.orientationDisplayAdjust);

	/* Ensure media queries above are applied on first load */
	window.addEventListener('load', vm.orientationDisplayAdjust);
};

/* Declare global objects */
var map;
var geocoder;
var geoMarker;
var directionsService;
var directionsDisplay;
var panorama;
var vm;

// Insert Google Maps script
var mapsScript   = document.createElement("script");
mapsScript.type  = "text/javascript";
mapsScript.src   = `https://maps.googleapis.com/maps/api/js?key=${KEYS.REFERRER}&callback=initMap&libraries=places`;
document.body.appendChild(mapsScript);

/* Callback function for the initial Google Maps API request */
var initMap = function() {
	/* Initiate google map object */
	map = new google.maps.Map(document.getElementById('map'), {
		zoom: 11,
		mapTypeControlOptions: {
			position: google.maps.ControlPosition.TOP_RIGHT,
			mapTypeIds: [google.maps.MapTypeId.ROADMAP, google.maps.MapTypeId.SATELLITE, google.maps.MapTypeId.HYBRID, google.maps.MapTypeId.TERRAIN]
		},
		disableDoubleClickZoom: true
	});

	/* Setup a streetview object in order to set the position of the address controls */
	panorama = map.getStreetView();
	panorama.setOptions({
		options: {
			addressControlOptions: {
				position: google.maps.ControlPosition.BOTTOM_CENTER
			}
		}
	});


	/* geolocation-marker in-lined here as it requires google api library but also needs to load before the view model*/
	(function(){
	/*
	 geolocation-marker version 2.0.5
	 @copyright 2012, 2015 Chad Killingsworth
	 @see https://github.com/ChadKillingsworth/geolocation-marker/blob/master/LICENSE.txt
	*/
	'use strict';var b;function e(a,c){function f(){}f.prototype=c.prototype;a.B=c.prototype;a.prototype=new f;a.prototype.constructor=a;for(var g in c)if("prototype"!=g)if(Object.defineProperties){var d=Object.getOwnPropertyDescriptor(c,g);d&&Object.defineProperty(a,g,d)}else a[g]=c[g]}
	function h(a,c,f,g){var d=google.maps.MVCObject.call(this)||this;d.c=null;d.b=null;d.a=null;d.i=-1;var l={clickable:!1,cursor:"pointer",draggable:!1,flat:!0,icon:{path:google.maps.SymbolPath.CIRCLE,fillColor:"#C8D6EC",fillOpacity:.7,scale:12,strokeWeight:0},position:new google.maps.LatLng(0,0),title:"Current location",zIndex:2},m={clickable:!1,cursor:"pointer",draggable:!1,flat:!0,icon:{path:google.maps.SymbolPath.CIRCLE,fillColor:"#4285F4",fillOpacity:1,scale:6,strokeColor:"white",strokeWeight:2},
	optimized:!1,position:new google.maps.LatLng(0,0),title:"Current location",zIndex:3};c&&(l=k(l,c));f&&(m=k(m,f));c={clickable:!1,radius:0,strokeColor:"1bb6ff",strokeOpacity:.4,fillColor:"61a0bf",fillOpacity:.4,strokeWeight:1,zIndex:1};g&&(c=k(c,g));d.c=new google.maps.Marker(l);d.b=new google.maps.Marker(m);d.a=new google.maps.Circle(c);google.maps.MVCObject.prototype.set.call(d,"accuracy",null);google.maps.MVCObject.prototype.set.call(d,"position",null);google.maps.MVCObject.prototype.set.call(d,
	"map",null);d.set("minimum_accuracy",null);d.set("position_options",{enableHighAccuracy:!0,maximumAge:1E3});d.a.bindTo("map",d.c);d.a.bindTo("map",d.b);a&&d.setMap(a);return d}e(h,google.maps.MVCObject);b=h.prototype;b.set=function(a,c){if(n.test(a))throw"'"+a+"' is a read-only property.";"map"===a?this.setMap(c):google.maps.MVCObject.prototype.set.call(this,a,c)};b.f=function(){return this.get("map")};b.l=function(){return this.get("position_options")};
	b.w=function(a){this.set("position_options",a)};b.g=function(){return this.get("position")};b.m=function(){return this.get("position")?this.a.getBounds():null};b.j=function(){return this.get("accuracy")};b.h=function(){return this.get("minimum_accuracy")};b.v=function(a){this.set("minimum_accuracy",a)};
	b.setMap=function(a){google.maps.MVCObject.prototype.set.call(this,"map",a);a?navigator.geolocation&&(this.i=navigator.geolocation.watchPosition(this.A.bind(this),this.o.bind(this),this.l())):(this.c.unbind("position"),this.b.unbind("position"),this.a.unbind("center"),this.a.unbind("radius"),google.maps.MVCObject.prototype.set.call(this,"accuracy",null),google.maps.MVCObject.prototype.set.call(this,"position",null),navigator.geolocation.clearWatch(this.i),this.i=-1,this.c.setMap(a),this.b.setMap(a))};
	b.u=function(a){this.b.setOptions(k({},a))};b.s=function(a){this.a.setOptions(k({},a))};
	b.A=function(a){var c=new google.maps.LatLng(a.coords.latitude,a.coords.longitude),f=!this.b.getMap();if(f){if(null!=this.h()&&a.coords.accuracy>this.h())return;this.c.setMap(this.f());this.b.setMap(this.f());this.c.bindTo("position",this);this.b.bindTo("position",this);this.a.bindTo("center",this,"position");this.a.bindTo("radius",this,"accuracy")}this.j()!=a.coords.accuracy&&google.maps.MVCObject.prototype.set.call(this,"accuracy",a.coords.accuracy);!f&&this.g()&&this.g().equals(c)||google.maps.MVCObject.prototype.set.call(this,
	"position",c)};b.o=function(a){google.maps.event.trigger(this,"geolocation_error",a)};function k(a,c){for(var f in c)!0!==p[f]&&(a[f]=c[f]);return a}var p={map:!0,position:!0,radius:!0},n=/^(?:position|accuracy)$/i;var q=window;function r(){h.prototype.getAccuracy=h.prototype.j;h.prototype.getBounds=h.prototype.m;h.prototype.getMap=h.prototype.f;h.prototype.getMinimumAccuracy=h.prototype.h;h.prototype.getPosition=h.prototype.g;h.prototype.getPositionOptions=h.prototype.l;h.prototype.setCircleOptions=h.prototype.s;h.prototype.setMap=h.prototype.setMap;h.prototype.setMarkerOptions=h.prototype.u;h.prototype.setMinimumAccuracy=h.prototype.v;h.prototype.setPositionOptions=h.prototype.w;return h}
	"function"===typeof q.define&&q.define.amd?q.define([],r):"object"===typeof q.exports?q.module.exports=r():q.GeolocationMarker=r();
	}).call(this)
	//# sourceMappingURL=geolocation-marker.js.map

	/* Initiate google maps objects that will be used */
	geocoder = new google.maps.Geocoder();
	geoMarker = new GeolocationMarker();
	geoMarker.setMarkerOptions({icon: icons.location});
	geoMarker.addListener('position_changed', function() {
		map.setCenter(geoMarker.getPosition());
	});
	directionsService = new google.maps.DirectionsService();
	directionsDisplay = new google.maps.DirectionsRenderer({map: map, suppressMarkers: true, draggable: true, suppressBicyclingLayer: true, panel: $('.directions')[0]});


	/* Initiate the View-model */
	ko.applyBindings(new viewModel());
};