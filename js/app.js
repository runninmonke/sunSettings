/*global $, google, ko, SunCalc*/
'use strict';

/* Maximum times a SunPlace will refine it's location */
var MAX_ATTEMPTS = 5;
/* Maximum error in ms allowed for estimate to be considered accurate */
var ESTIMATE_RANGE = 30000;

var timeFormatLocale = 'en-US';

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
		travelMode: google.maps.TravelMode.DRIVING
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


	self.active = ko.observable(true);

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

	self.getWeather();

	/* Run methods dependent on time, but don't change time */
	self.createTime();

	if (self.marker) {
		self.marker.setPosition(self.latLng());
	} else {
		self.createMarker();
	}
};

/* TODO: Implement display of weather at start and finsih of trip */
/* Get locale weather data */
Place.prototype.getWeather = function() {
//	var self = this;
	/* Use an API to get weather info*/
/*	$.getJSON('https://api.apixu.com/v1/forecast.json?key=f7fc2a0c018f47c688b200705150412&q=' + self.latLng().lat() + ',' + self.latLng().lng(), function(results) {
		self.weather = results;
	}).fail(function() {
		alert('Weather data not available');
	});
*/
};

/* Calculate local sun times */
Place.prototype.getSunTimes = function() {
	this.sun = SunCalc.getTimes(this.time, this.latLng().lat(), this.latLng().lng());
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


/* Check for what data has been successfully retrieved and build content for infoWindow by plugging it into the template */
Place.prototype.buildContent = function() {
	var timeZoneName = 'UTC';
	this.displayTime.meridie = 'AM';

	if (this.timeZone) {
		timeZoneName = this.timeZone.timeZoneName;
		this.displayTime.setTime(this.time.getTime() + (this.timeZone.rawOffset + this.timeZone.dstOffset) * 1000);
	} else {
		this.displayTime.setTime(this.time.getTime());
	}

	this.displayTime.hours = this.displayTime.getUTCHours();
	this.displayTime.minutes = this.displayTime.getUTCMinutes().toString();
	this.displayTime.seconds = this.displayTime.getUTCSeconds().toString();

	if (this.displayTime.hours > 12) {
		this.displayTime.meridie = 'PM';
		this.displayTime.hours = this.displayTime.hours - 12;
	} else if (this.displayTime.hours == 12) {
		this.displayTime.meridie = 'PM';
	} else if (this.displayTime.hours == 0) {
		this.displayTime.hours = '12';
	}

	if (this.displayTime.minutes.length < 2) {
		this.displayTime.minutes = '0' + this.displayTime.minutes;
	}

	if (this.displayTime.seconds.length < 2) {
		this.displayTime.seconds = '0' + this.displayTime.seconds;
	}

	var displayTimeString = this.displayTime.hours + ':' + this.displayTime.minutes + ':' +  this.displayTime.seconds + ' ' + this.displayTime.meridie;

	this.content = this.template.start;
	this.content += this.template.name.replace('%text%', this.displayName);

	this.content += this.template.time.replace('%time%', displayTimeString).replace('%timezone%', timeZoneName);
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
};

SunPlace.prototype = Object.create(Place.prototype);
SunPlace.prototype.constructor = SunPlace;

SunPlace.prototype.finalize = function() {
	this.template.time = contentTemplate.time;
	this.setLatLng(this.latLng());
	this.toggleSelected();
};

SunPlace.prototype.refineEstimate = function(pathSection, startTime) {
	var self = this;
	self.refineAttemps++;

	/* Esimate location of sun event along path */
	var eventLocationEstimate;
	var previousEstimate = -2;
	while(true) {
		eventLocationEstimate = (self.time.getTime() - startTime) / (pathSection.duration.value * 1000);
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

			var arrivalTime = startTime + newPathSection.duration.value * 1000;
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

/***************************/
/****** Journey Class ******/
/***************************/
var Journey = function(start, finish) {
	this.startPlace = start;
	this.finishPlace = finish;
	this.sunEvents = [];
};

Journey.prototype.loadRoute = function(route) {
	this.route = route;
	this.route.notFromDrag = true;

	directionsDisplay.setDirections(route);

	this.finishPlace().createTime(this.startPlace().time.getTime() + this.getTravelTime());

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
	var eventsOfInterest = ['sunrise', 'sunset'];

	var locationTime = new Date(this.startPlace().time.getTime());
	var nextLocationTime = new Date(locationTime.getTime());
	var sunEventTime = new Date(locationTime.getTime());
	var nextSunEventTime;
	var sunEventName;

	var path = this.route.routes[0].legs[0].steps;
	var locationSunTimes = SunCalc.getTimes(sunEventTime, path[0].start_location.lat(), path[0].start_location.lng());


	var findNextSunEvent = function(lastSunTime) {
		var potentialTimes = [];

		/* Check for sun events that have yet to occur */
		for (var i = 0; i < eventsOfInterest.length; i++) {
			if (locationSunTimes[eventsOfInterest[i]].getTime() > lastSunTime) {
				potentialTimes.push({time: locationSunTimes[eventsOfInterest[i]], name: eventsOfInterest[i]});
			}
		}

		/* Find sun event yet to occur that will occur soonest */
		var minTime = 99999999999999;
		var iTime;

		for (var i = 0; i < potentialTimes.length; i++) {
			iTime = potentialTimes[i].time.getTime();
			if (iTime < minTime) {
				minTime = iTime;
				sunEventTime.setTime(iTime);
				sunEventName = potentialTimes[i].name;
			}
		}

		/* If no results, add 24 hours to the time the sun events are calculated from and re-try */
		if (potentialTimes.length == 0) {
			sunEventTime.setTime(sunEventTime.getTime() + 86400000);
			locationSunTimes = SunCalc.getTimes(sunEventTime, path[0].start_location.lat(), path[0].start_location.lng());
			findNextSunEvent(lastSunTime);
		}
	};

	self.resetSunEvents();

	findNextSunEvent(locationTime.getTime());
	
	/* Find next sun event on path and repeat until end is reached */
	var reachEnd;
	while(path.length > 0) {
		/* Check each section of path until next sun event is found */
		reachEnd = true;
		for (var i = 0; i < path.length; i++) {
			nextLocationTime.setTime(locationTime.getTime() + (path[i].duration.value * 1000));
			nextSunEventTime = SunCalc.getTimes(sunEventTime, path[i].end_location.lat(), path[i].end_location.lng())[sunEventName];

			/* Set values for next iteration if no sun event occurs during current section */
			if (nextSunEventTime.getTime() > nextLocationTime.getTime()) {
				locationTime.setTime(nextLocationTime.getTime());

				sunEventTime.setTime(nextSunEventTime.getTime());
				locationSunTimes = SunCalc.getTimes(sunEventTime, path[i].end_location.lat(), path[i].end_location.lng());
			} else {
				/* One last conditional necessary to make sure we are using a sun event time that will occur during the travel time of the current section */
				if (sunEventTime.getTime() > nextLocationTime.getTime()) {
					sunEventTime.setTime(nextSunEventTime.getTime());
					locationSunTimes = SunCalc.getTimes(sunEventTime, path[i].end_location.lat(), path[i].end_location.lng());
				}

				/* Create sun event and call the estimation of its location*/
				var sunEvent = new SunPlace({name: sunEventName}); 
				sunEvent.createTime(sunEventTime.getTime());
				self.sunEvents.push(sunEvent);
				sunEvent.refineEstimate(path[i], locationTime.getTime());

				/* Remove path that has already been checked before next iteration */
				path = path.slice(i);
				reachEnd = false;
				break;
			}
		}

		if (reachEnd) {
			break;
		}


		findNextSunEvent(sunEventTime.getTime());
	}
};

Journey.prototype.getTravelTime = function() {
	if (this.hasOwnProperty('route')) {
		var travelTime = 0;
		var legs = this.route.routes[0].legs;
		for (var i = 0; i < legs.length; i++) {
			travelTime += legs[i].duration.value * 1000;
		}
		return travelTime;
	} else {
		return 0;
	}
};

/************************/
/****** View Model ******/
/************************/
var viewModel = function() {
	vm = this;
	vm.startPlace = ko.observable(new Waypoint({name: 'departure'}));
	vm.finishPlace = ko.observable(new Waypoint({name: 'arrival'}));
	vm.journey = ko.observable();
	vm.departureTime = ko.observable();

	/* Increase map zoom level on large displays */
	if (window.matchMedia('(min-width: 700px)').matches) {
		map.setZoom(12);
	}

	vm.showAlert = ko.observable(true);
	$('.alert-window .field').focus();

	vm.inputStart = function() {
		vm.startPlace(new Waypoint({name: 'start', address: $('.alert-window .field').val()}));

		$('.start-content').toggleClass('hidden', true);
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
			$('.start-content').toggleClass('hidden', true);
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

	vm.showTimeSettings = function() {
		var currentTime = vm.departureTime() || vm.startPlace().time;

		$('.alert-window').css('width', '210px');
		$('.alert-window').css('min-width', '210px');
		$('.time-content').toggleClass('hidden', false);

		$('.month').val(vm.startPlace().displayTime.getUTCMonth() + 1);
		$('.day').val(vm.startPlace().displayTime.getUTCDate());
		$('.year').val(vm.startPlace().displayTime.getUTCFullYear());

		$('.hours').val(vm.startPlace().displayTime.hours);
		$('.minutes').val(vm.startPlace().displayTime.minutes);
		$('.seconds').val(vm.startPlace().displayTime.seconds);

		$('.meridies').val(vm.startPlace().displayTime.meridie);

		$('.form-container').toggleClass('hidden', true);
		vm.showAlert(true);
		$('.date').focus();
	};

	/* TODO: Add error handling */
	vm.setDepartureTime = function() {
		
		var newHours = $('.hours').val();
		if ($('.meridies').val() == 'PM' && newHours < 12) {
			newHours = newHours * 1 + 12;
		} else if ($('.meridies').val() == 'AM' && newHours == 12) {
			newHours = 0;
		}

		var newMonth = $('.month').val() - 1;

		vm.departureTime(new Date($('.year').val(), newMonth, $('.day').val(), newHours, $('.minutes').val(), $('.seconds').val()));
		
		vm.startPlace().createTime(vm.departureTime().getTime());
		vm.startPlace().buildContent();

		$('.time-content').toggleClass('hidden', true);
		vm.showAlert(false);

		$('.set-time').focus();
	};

	vm.removeDepartureTime = function() {
		vm.departureTime(undefined);
		vm.timer();
		vm.showAlert(false);
		$('.set-time').focus();
	};

	vm.reset = function() {
		vm.finishPlace().reset();
		vm.journey().resetSunEvents();
		vm.journey(undefined);
		directionsDisplay.setMap(null);
		directionsDisplay = new google.maps.DirectionsRenderer({map: map, suppressMarkers: true, draggable: true});
		map.setCenter(vm.startPlace().latLng());

		$('.set-time').toggleClass('hidden', false);
		$('.reset').toggleClass('hidden', true);
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
		if (vm.startPlace().latLng() && vm.finishPlace().latLng()) {
			if (vm.journey()) {
				vm.journey().resetSunEvents();
			}

			if (!vm.departureTime()) {
				vm.startPlace().createTime(Date.now());
			}

			vm.journey(new Journey(vm.startPlace, vm.finishPlace));

			GetRoute(vm.startPlace().latLng(), vm.finishPlace().latLng(), vm.directionsCallback);

			/* Pass in nothing for evt or obj, but pass 'open' for actionCase so the menu gets closed if it's open */
			vm.toggleMenu(null, null, 'open');
			
			$('.set-time').toggleClass('hidden', true);
			$('.reset').toggleClass('hidden', false);
		}
	});


	/* Listens for route drag events and reloads route */
	directionsDisplay.addListener('directions_changed', function() {
		var directionsRoute = directionsDisplay.getDirections();

		if (!directionsRoute.hasOwnProperty('notFromDrag')) {
			vm.journey().loadRoute(directionsRoute);
		}
	});

	/* Variables for weather section display */
	vm.conditionImg = ko.observable('');
	vm.currentCondition = ko.observable('');
	vm.currentTemp = ko.observable('');
	vm.maxTemp = ko.observable('');
	vm.minTemp = ko.observable('');

	/* TODO: Implement weather */
	/* Display neighborhood weather in nav bar */
	vm.displayWeather = function(weather) {
		vm.conditionImg('http://' + weather.current.condition.icon);
		vm.currentCondition(weather.current.condition.text);
		vm.currentTemp(weather.current.temp_f + '°F');
		vm.maxTemp(weather.forecast.forecastday[0].day.maxtemp_f + '°F');
		vm.minTemp(weather.forecast.forecastday[0].day.mintemp_f + '°F');
	};

	var autocompleteStart = new google.maps.places.Autocomplete($('.departure .field')[0]);
	var autocompleteFinish = new google.maps.places.Autocomplete($('.arrival .field')[0]);
	var autocompleteAlert = new google.maps.places.Autocomplete($('.alert-window .field')[0]);
	
	autocompleteStart.bindTo('bounds', map);
	autocompleteFinish.bindTo('bounds', map);
	
	$('body').on('focus', 'input', function(evt) {
		evt.currentTarget.setSelectionRange(0, 999);
	});

	/* Listener to deal with body overflow that occurs on iPhone in lanscape orientation*/
	$(function() {
		window.addEventListener('scroll', function(){
			var mq = window.matchMedia('only screen and (max-device-width: 600px) and (orientation: landscape)');
			if (mq.matches || window.pageYOffset < 0) {
				window.scrollTo(0, 0);
			}
		});

		window.addEventListener('resize', function() {
			var mq = window.matchMedia('only screen and (max-device-width: 600px) and (orientation: landscape)');
			if (mq.matches) {
				$('#nav-bar').toggleClass('hidden', true);
				$('#hamburger').toggleClass('hidden', true);
				$('.alert-container').toggleClass('hidden', true);
			} else {
				$('#nav-bar').toggleClass('hidden', false);
				$('#hamburger').toggleClass('hidden', false);
				$('.alert-container').toggleClass('hidden', false);
			}

			if (window.pageYOffset < 0) {
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
			position: google.maps.ControlPosition.TOP_RIGHT
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
	directionsDisplay = new google.maps.DirectionsRenderer({map: map, suppressMarkers: true, draggable: true});

	/* Initiate the View-model */
	ko.applyBindings(new viewModel());
};