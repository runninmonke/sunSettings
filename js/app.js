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
	start: '<div class="info-window">',
	end: '</div>'
};

var icons = {
	standard: {img: 'imgs/default.png', pixelOffset:{width: 0, height: 0}},
	day: {img: 'imgs/day.png', pixelOffset:{width: 0, height: 16}},
	night: {img: 'imgs/night.png', pixelOffset:{width: 0, height: 0}},
	sunset: {img: 'imgs/sunset.png', pixelOffset:{width: 0, height: 16}},
	sunrise: {img: 'imgs/sunrise.png', pixelOffset:{width: 0, height: 16}}
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

	/* Assigns to observable if it exists, otherwise regular assignment */
	for (var item in data) {
		if (data.hasOwnProperty(item)) {
			self[item] ? self[item](data[item]) : self[item] = data[item];
		}
	}

	self.displayName = self.name[0].toUpperCase() + self.name.slice(1);
	self.time = new Date();
	self.displayTime = new Date();
	self.timeZone = undefined;
	self.status = 'deselected';
	self.content = '';


	/* Deep copy template so object's infoWindow template content can be modified */
	self.template = {};
	for (item in contentTemplate) {
		if (contentTemplate.hasOwnProperty(item)) {
			self.template[item] = contentTemplate[item];
		}
	}

	self.icon = icons.standard;
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

	if (this.marker) {
		this.marker.setMap(null);
		delete this.marker;		
	}
};

/* Populate properties with Geocoderesults */
Place.prototype.getGeocodeInfo = function() {
	var self = this;
	var data;

	if (self.latLng()) {
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
			alert('Location data unavailable. Geocoder failed:' + status);
		}
	});
};

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

	if (this.constructor == SunPlace) {
		return;
	}

	/* Use an API to get weather info*/
	$.getJSON('https://api.apixu.com/v1/forecast.json?key=f7fc2a0c018f47c688b200705150412&q=' + self.latLng().lat() + ',' + self.latLng().lng() + '&days=10', function(results) {
		self.weatherData = results;

		/* Determine amount API times are offset from UTC. Assumes time offset will be some increment of 30 minutes */
		var timesDif = Date.now() - self.weatherData.location.localtime_epoch * 1000;
		self.weatherData.timeAdjust = Math.round(timesDif / 1800000) / 2 * 3600000;
		self.getWeather();
	}).fail(function() {
		alert('Weather data not available');
	});

};

Place.prototype.getWeather = function() {
	var placeTimeVsWeatherTime = this.time.getTime() - (this.weatherData.current.last_updated_epoch * 1000 + this.weatherData.timeAdjust);
	var placeTimeVsForecastStart = this.time.getTime() - (this.weatherData.forecast.forecastday[0].hour[0].time_epoch * 1000 + this.weatherData.timeAdjust);

	if (placeTimeVsWeatherTime < -HOUR) {
		this.weather(undefined);
	} else if (placeTimeVsWeatherTime < HOUR){
		this.weather(this.weatherData.current);
	} else if (placeTimeVsForecastStart < (10 * DAY)) {
		var forecastDay = Math.floor(placeTimeVsForecastStart/DAY);
		var forecastHour = Math.floor(placeTimeVsForecastStart/HOUR) % 24;
		this.weather(this.weatherData.forecast.forecastday[forecastDay].hour[forecastHour]);
	} else {
		this.weather(undefined);
	}
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
	var url = 'https://maps.googleapis.com/maps/api/timezone/json?location=' + self.latLng().lat() + ',' + self.latLng().lng() + '&timestamp=' + self.time.getTime()/1000 + '&key=AIzaSyB7LiznjiujsNwqvwGu7jMg6xVmnVTVSek';
	$.getJSON(url, function(results){
		if (results.status == 'OK') {
			self.timeZone = results;
		} else {
			self.timeZone = undefined;
		}
		self.buildContent();
	});

	/* Also getWeather update if weatherData is available */
	if (this.hasOwnProperty('weatherData')) {
		this.getWeather();
	}
};

Place.prototype.createTime = function(newTime) {
	newTime = newTime || this.time.getTime();
	
	var newTimeObj = new Date(newTime);
	var timeDif = Math.abs(newTime - this.time.getTime());
	var isNewHour = this.time.getHours() == newTimeObj.getHours() ? false : true;

	this.time.setTime(newTime);

	if (this.latLng()) {
		/* Only get time zone info when call doesn't change time or when hour changes */
		if (timeDif == 0 || timeDif >= 3600000 || isNewHour) {
			this.getTimeZone();
		}
		this.getSunTimes();
		this.buildContent();
	}
};

/* Return a date object where the UTC time is actually the local timezone time. Objject includes additional useful properties like 'string' which is a formatted string of the time */
function getDisplayTime(time, timeZoneOffset) {
	var displayTime = new Date(time.getTime() + timeZoneOffset);
	displayTime.meridie = 'AM';

	displayTime.hours = displayTime.getUTCHours();
	displayTime.minutes = displayTime.getUTCMinutes().toString();
	displayTime.seconds = displayTime.getUTCSeconds().toString();

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

	displayTime.string = displayTime.hours + ':' + displayTime.minutes + ':' +  displayTime.seconds + ' ' + displayTime.meridie;

	return displayTime;
}


/* Check for what data has been successfully retrieved and build content for infoWindow by plugging it into the template */
Place.prototype.buildContent = function() {
	this.timeZoneName = 'UTC';

	if (this.timeZone) {
		this.timeZoneName = this.timeZone.timeZoneName;
		this.timeZoneOffset = (this.timeZone.rawOffset + this.timeZone.dstOffset) * 1000;
	} else {
		this.timeZoneOffset = 0;
	}

	this.displayTime = getDisplayTime(this.time, this.timeZoneOffset);

	for (var item in this.sun) {
		if (this.sun.hasOwnProperty(item)) {
			this.sun[item].displayTime = getDisplayTime(this.sun[item], this.timeZoneOffset).string;
		}
	}

	this.content = this.template.start;
	this.content += this.template.name.replace('%text%', this.displayName);

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
		this.marker.setOptions({icon: this.icon.img});
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
		icon: self.icon.img
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

	vm.journey().finalize();
};

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

			console.log('QL hit');
		} else {
			console.log(status, result);
		}
	};

	if (self.refineAttemps <= MAX_ATTEMPTS) {
		GetRoute(pathSection.path[0], self.latLng(), directionsCallback);
	} else {
		self.finalize();
	}
};


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
	$('.alert-window .field').focus();

	vm.inputStart = function() {
		vm.startPlace(new Waypoint({name: 'start', address: $('.alert-window .field').val()}));

		$('.start-container').toggleClass('hidden', true);
		vm.showAlert(false);

		/* Re-bind autocomplete functionality otherwise Knockout interupts it*/
		autocompleteStart = new google.maps.places.Autocomplete($('.start .field')[0]);
		autocompleteStart.bindTo('bounds', map);
		$('.arrival input').focus();
	};

	vm.getStartLocation = function(position) {
		if (position) {
			var latLng = new google.maps.LatLng(position.coords.latitude, position.coords.longitude);
				
			vm.startPlace().setLatLng(latLng);
			$('.start-container').toggleClass('hidden', true);
			vm.showAlert(false);
			$('.arrival input').focus();
		}
	};

	if (navigator.geolocation) {
		navigator.geolocation.getCurrentPosition(vm.getStartLocation);
	} else {
		alert('Browser not supported');
	}

	vm.menuStatus = ko.observable('closed');

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

	vm.toggleMenu();

	vm.travelModeClick = function(obj, evt) {
		if (evt.target.tagName == "BUTTON") {
			vm.travelMode(evt.target.value);
			$('.travel-mode button').attr('class', 'deselected');
			evt.target.className = 'selected';
		}
	};

	vm.reset = function() {
		vm.finishPlace().reset();
		vm.journey().resetSunEvents();
		vm.journey(undefined);
		vm.paceMultiplier(1000);
		directionsDisplay.set('directions', null);
		map.setCenter(vm.startPlace().latLng());

		$('.reset').toggleClass('hidden', true);
		$('.return-trip').toggleClass('hidden', true);
		$('.arrival .set-time').toggleClass('hidden', true);
		$('.tabs :first').click();
		vm.hidePaceSettings();
	};

	vm.showTimeSettings = function() {
		$('.message').text(this.displayName);
		$('.alert-window').css('width', '210px');
		$('.alert-window').css('min-width', '210px');
		$('.time-container').toggleClass('hidden', false);

		$('.month').val(this.displayTime.getUTCMonth() + 1);
		$('.day').val(this.displayTime.getUTCDate());
		$('.year').val(this.displayTime.getUTCFullYear());

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
		$('.date').focus();
	};

	vm.getNewTime = function() {
		var newHours = $('.hours').val();
		if ($('.meridies').val() == 'PM' && newHours < 12) {
			newHours = newHours * 1 + 12;
		} else if ($('.meridies').val() == 'AM' && newHours == 12) {
			newHours = 0;
		}

		var newMonth = $('.month').val() - 1;

		return new Date(Date.UTC($('.year').val(), newMonth, $('.day').val(), newHours, $('.minutes').val(), $('.seconds').val()));
	};

	/* TODO: Add error handling */
	vm.setDepartureTime = function() {
		var newTime = vm.getNewTime();
		newTime.setTime(newTime.getTime() + (-1 * vm.startPlace().timeZoneOffset));
		
		vm.departureTime(newTime);
		vm.startPlace().createTime(newTime.getTime());

		$('.time-container').toggleClass('hidden', true);
		vm.showAlert(false);

		$('.departure .set-time').focus();
	};

	vm.removeDepartureTime = function() {
		vm.departureTime(undefined);
		vm.timer();
		vm.showAlert(false);
		$('.set-time').focus();
	};


	vm.setArrivalTime = function() {
		var newTime = vm.getNewTime();
		newTime.setTime(newTime.getTime() + (-1 * vm.finishPlace().timeZoneOffset));

		var newPace = (newTime.getTime() - vm.startPlace().time.getTime()) / vm.journey().duration();

		newPace = newPace * vm.paceMultiplier();

		$('.time-container').toggleClass('hidden', true);
		vm.showAlert(false);

		$('.arrival .set-time').focus();
		vm.changePace({}, {}, newPace);
	};

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

	vm.changePace = function(obj, evt, newPace) {
		newPace = newPace || vm.paceMph / $('.pace input')[0].value * vm.paceMultiplier();
		vm.paceMultiplier(newPace);
		vm.hidePaceSettings;
	};

	vm.resetPace = function() {
		vm.paceMultiplier(1000);
		vm.hidePaceSettings();
	};

	vm.cancelTime = function() {
		vm.showAlert(false);
	};

	vm.getReturnTrip = function() {
		var newFinishLatLng = new google.maps.LatLng({lat: vm.startPlace().latLng().lat(), lng: vm.startPlace().latLng().lng()});
		vm.startPlace().setLatLng(vm.finishPlace().latLng());
		vm.departureTime(new Date(vm.finishPlace().time.getTime()));
		vm.startPlace().createTime(vm.departureTime().getTime());
		vm.finishPlace().setLatLng(newFinishLatLng);
	};

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
		if (vm.startPlace().latLng() && vm.finishPlace().latLng() && vm.paceMultiplier()) {
			if (vm.journey()) {
				vm.journey().resetSunEvents();
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
		}
	});


	/* Listens for route drag events and reloads route */
	directionsDisplay.addListener('directions_changed', function() {
		var directionsRoute = directionsDisplay.getDirections();

		if (directionsRoute && !directionsRoute.hasOwnProperty('notFromDrag')) {
			vm.journey().loadRoute(directionsRoute);
		}
	});

	vm.selectedTab = ko.observable(vm.startPlace());

	vm.showPlace = ko.pureComputed(function() {
		if (vm.selectedTab().hasSunDisplayTime()) {
			return true;
		}
	});
	
	vm.selectedSunrise = ko.pureComputed(function() {
		if (vm.selectedTab().hasSunDisplayTime()) {
			return getDisplayTime(vm.selectedTab().sun.sunrise, vm.selectedTab().timeZoneOffset).string;
		}
	});

	vm.selectedSunset = ko.pureComputed(function() {
		if (vm.selectedTab().hasSunDisplayTime()) {
			return getDisplayTime(vm.selectedTab().sun.sunset, vm.selectedTab().timeZoneOffset).string;
		}
	});

	vm.dayLength = ko.computed(function() {
		if (vm.selectedTab().hasSunDisplayTime()) {
			return getDurationString(vm.selectedTab().sun.sunset.getTime() - vm.selectedTab().sun.sunrise.getTime());
		}
	});

	vm.showWeather = ko.pureComputed(function(){
		if (vm.selectedTab().weather()) {
			vm.displayWeather(vm.selectedTab().weather());
			return true;
		}
	});

	vm.tabClick = function(obj, evt) {
		var tab = evt.target.textContent;
		if ((tab == 'Finish' && !vm.finishPlace().latLng()) || (tab == 'Travels' && !vm.journey())) {
			return;
		}

		$('.tabs div').attr('class', 'deselected');
		evt.target.className = 'selected';

		if (tab == 'Travels') {
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

	vm.daylightChangeDisplay = ko.pureComputed(function() {
		if (vm.journey() && $.isNumeric(vm.journey().sunlightChange())) {
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
	vm.conditionImg = ko.observable('');
	vm.currentCondition = ko.observable('');
	vm.currentTemp = ko.observable('');

	/* TODO: Implement weather */
	/* Display neighborhood weather in nav bar */
	vm.displayWeather = function(weather) {
		vm.conditionImg('http://' + weather.condition.icon);
		vm.currentCondition(weather.condition.text);
		vm.currentTemp(weather.temp_f + '°F');
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
	
	/* Deal with iPhone display bug that arrises otherwise */
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

	/* Listener to deal with body overflow that occurs on iPhone 4 in lanscape orientation*/
	$(function() {
		window.addEventListener('scroll', function(){
			var mq = window.matchMedia('only screen and (max-device-width: 600px) and (orientation: landscape)');
			if (mq.matches && !vm.showAlert()) {
				window.scrollTo(0, 0);
			}
		});
	});
};

/* Declare global objects */
var map;
var geocoder;
var directionsService;
var directionsDisplay;
var panorama;
var vm;

/* Callback function for the initial Google Maps API request */
var initMap = function() {
	/* Initiate google map object */
	map = new google.maps.Map(document.getElementById('map'), {
		zoom: 11,
		mapTypeControlOptions: {
			position: google.maps.ControlPosition.TOP_RIGHT,
			mapTypeIds: [google.maps.MapTypeId.ROADMAP, google.maps.MapTypeId.SATELLITE, google.maps.MapTypeId.HYBRID, google.maps.MapTypeId.TERRAIN]
		}
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

	/* Initiate google maps objects that will be used */
	geocoder = new google.maps.Geocoder();

	/* Direction services */
	directionsService = new google.maps.DirectionsService();
	directionsDisplay = new google.maps.DirectionsRenderer({map: map, suppressMarkers: true, draggable: true, suppressBicyclingLayer: true, panel: $('.directions')[0]});

	/* Initiate the View-model */
	ko.applyBindings(new viewModel());
};