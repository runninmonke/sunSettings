/*global $, google, ko, SunCalc*/
'use strict';

var timeFormatLocale = 'en-US';

/*eslint-disable quotes*/
/* Template used format data into infoWindow DOM elements */
var contentTemplate = {
	sun: '<p>Sunrise: %sunrise%<br>Solar noon: %noon%<br>Sunset: %sunset%</p><p class="time-zone">in %timezone%</p>',
	name: '<h3>%text%</h3>',
	start: "<div class='info-window'>",
	end: '</div>'
};
/*eslint-enable quotes*/

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
			self.setAddress($('.' + self.name.toLowerCase() + ' .field')[0].value);
		},
		owner: this
	});


	self.active = ko.observable(true);

	/* Assigns to observable if it exists, otherwise regular assignment */
	for (var item in data) {
		if (data.hasOwnProperty(item)) {
			self[item] ? self[item](data[item]) : self[item] = data[item];
		}
	}

	self.status = 'deselected';

	self.time = new Date();

	/* Loading message in case content is slow to build */
	self.content = 'Loading...';

	self.infoWindow = new google.maps.InfoWindow();
	

	/* Get missing address or LatLng and then additional data*/
	if (!self.latLng() && self.address()) {
		self.getGeocodeInfo({address: self.address()});
	} else if (self.latLng() && !self.address()) {
		self.getGeocodeInfo({latLng: self.latLng()});
		self.useLatLngForInfo();
	} else if (self.latLng()) {
		self.useLatLngForInfo();
	}
};

/* Reset LatLng dependent attributes with new Latlng */
Place.prototype.setLatLng = function(latLng) {
	this.reset();

	this.latLng(latLng);
	this.getGeocodeInfo({latLng: latLng});
	this.useLatLngForInfo();
};

Place.prototype.setAddress = function(address) {
	this.reset();

	this.address(address);
	this.getGeocodeInfo({address: address});
};

Place.prototype.reset = function() {
	this.latLng(undefined);
	this.address(undefined);
	this.content = 'Loading...';
	this.status = 'deselected';

	if (this.marker) {
		this.marker.setMap(null);
		delete this.marker;		
	}
};

/* Populate properties with Geocoderesults */
Place.prototype.getGeocodeInfo = function(data) {
	var self = this;

	/* Request geocoder info and then call all functions dependent on the results */
	geocoder.geocode(data, function(results, status) {
		if (status == google.maps.GeocoderStatus.OK) {
			self.address(results[0].formatted_address);
			if (!self.latLng()) {
				self.latLng(results[0].geometry.location);
				self.useLatLngForInfo();
			}
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
	self.setTime();

	if (self.marker) {
		self.marker.setPosition(self.latLng());
	} else {
		self.createMarker();
	}

	map.setCenter(self.latLng());
};

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
	this.buildContent();
};

/* Get locale timezone information */
Place.prototype.getTimeZone = function() {
	var self = this;
	var url = 'https://maps.googleapis.com/maps/api/timezone/json?location=' + self.latLng().lat() + ',' + self.latLng().lng() + '&timestamp=' + self.time.getTime()/1000 + '&key=AIzaSyB7LiznjiujsNwqvwGu7jMg6xVmnVTVSek';
	$.getJSON(url, function(results){
		if (results.status == 'OK') {
			self.timeZone = results;
			self.buildContent();
		}
	});
};

Place.prototype.setTime = function(newTime) {
	this.time = newTime || this.time;

	if (this.latLng()) {
		this.getTimeZone();
		this.getSunTimes();
	}
};


/* Check for what data has been successfully retrieved and build content for infoWindow by plugging it into the template */
Place.prototype.buildContent = function() {
	this.content = contentTemplate.start;
	this.content += contentTemplate.name.replace('%text%', this.name);

	if (this.sun) {
		var options = {timeZone: 'UTC'};
		var timeZoneName = 'UTC';

		if (this.hasOwnProperty('timeZone')) {
			options = {timeZone: this.timeZone.timeZoneId};
			timeZoneName = this.timeZone.timeZoneName;
		}

		this.content += contentTemplate.sun.replace('%sunrise%', this.sun.sunrise.toLocaleTimeString())
			.replace('%noon%', this.sun.solarNoon.toLocaleTimeString(timeFormatLocale, options))
			.replace('%sunset%', this.sun.sunset.toLocaleTimeString(timeFormatLocale, options)).replace('%timezone%', timeZoneName);
	}

	this.content += contentTemplate.end;

	this.infoWindow.setContent(this.content);
};

/* Use latLng data to create map marker */
Place.prototype.createMarker = function() {
	var self = this;

	/* Create map marker */
	self.marker = new google.maps.Marker({
		position: self.latLng(),
		map: map,
		title: self.name,
		draggable: true
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

/***************************/
/****** Journey Class ******/
/***************************/
var Journey = function(start, finish) {
	this.startPlace = start;
	this.finishPlace = finish;
	this.sunEvents = [];
};

Journey.prototype.getRoute = function(origin, destination, callback) {
	var data = {
		origin: origin,
		destination: destination,
		travelMode: google.maps.TravelMode.DRIVING
	};
	
	directionsService.route(data, callback);
};

Journey.prototype.loadRoute = function(route) {
	this.route = route;
	this.route.notFromDrag = true;

	directionsDisplay.setDirections(route);

	this.finishPlace().setTime(new Date(this.startPlace().time.getTime() + this.getTravelTime()));

	this.analyzeRoute();
};

Journey.prototype.analyzeRoute = function() {
	var self = this;
	var eventsOfInterest = ['sunrise', 'sunset'];

	var locationTime = new Date(this.startPlace().time.getTime());
	var nextLocationTime = new Date(locationTime.getTime());
	var sunEventTime = new Date(locationTime.getTime());
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
				//console.log(sunEventTime, new Date(lastSunTime));
			}
		}

		/* If no results, add 24 hours to the time the sun events are calculated from and re-try */
		if (potentialTimes.length == 0) {
			sunEventTime.setTime(sunEventTime.getTime() + 86400000);
			locationSunTimes = SunCalc.getTimes(sunEventTime, path[0].start_location.lat(), path[0].start_location.lng());
			findNextSunEvent(lastSunTime);
		}
	};

	var placeSunEvent = function(pathSection) {
		var timeTilSunEvent = sunEventTime.getTime() - locationTime.getTime();
		var eventRatioEstimate = timeTilSunEvent / (nextLocationTime.getTime() - locationTime.getTime());
		var eventLocationEstimate = pathSection.length * eventRatioEstimate;
		eventLocationEstimate = Math.round(eventLocationEstimate);

		var sunEventDisplayName = sunEventName[0].toUpperCase() + sunEventName.slice(1);

		var sunEvent = new Place({name: sunEventDisplayName, latLng: pathSection[eventLocationEstimate]});
		self.sunEvents.push(sunEvent);

		var directionsCallback = function(result, status) {
			if (status == 'OK') {
				console.log('!', new Date(self.startPlace().time.getTime() + result.routes[0].legs[0].duration.value * 1000), sunEvent.sun[sunEventDisplayName.toLowerCase()]);
			} else {
				console.log(status);
			}
		};

		self.getRoute(self.startPlace().latLng(), sunEvent.latLng(), directionsCallback);
	};

	findNextSunEvent(locationTime.getTime());
	
	var reachEnd;
	for (var j = 0; j < 5; j++) {
		reachEnd = true;
		for (var i = 0; i < path.length; i++) {
			/* Determine time at end of path */
			nextLocationTime.setTime(locationTime.getTime() + (path[i].duration.value * 1000));

			/* Refine sun event times based on new location */
			sunEventTime = SunCalc.getTimes(sunEventTime, path[i].end_location.lat(), path[i].end_location.lng())[sunEventName];
			locationSunTimes = SunCalc.getTimes(sunEventTime, path[i].end_location.lat(), path[i].end_location.lng());

			if (sunEventTime.getTime() < nextLocationTime.getTime()) {
				placeSunEvent(path[i].path);
				path = path.slice(i);
				reachEnd = false;
				break;
			} else {
				locationTime.setTime(nextLocationTime.getTime());
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
	vm.startPlace = ko.observable(new Place({name: 'Start'}));
	vm.finishPlace = ko.observable(new Place({name: 'Finish'}));
	vm.journey = ko.observable();

	/* Increase map zoom level on large displays */
	if (window.matchMedia('(min-width: 700px)').matches) {
		map.setZoom(12);
	}

	vm.showAlert = ko.observable(true);
	vm.alertMessage = ko.observable('Allow geolocation or enter starting location:');
	$('.alert-window .field').focus();

	vm.inputStart = function() {
		vm.startPlace(new Place({name: 'Start', address: $('.alert-window .field')[0].value}));
		vm.showAlert(false);
	};

	vm.getStartLocation = function(position) {
		if (position) {
			var latLng = new google.maps.LatLng(position.coords.latitude, position.coords.longitude);
			
			map.setCenter(latLng);		
			vm.startPlace().setLatLng(latLng);
			vm.showAlert(false);
		}
	};

	if (navigator.geolocation) {
		navigator.geolocation.getCurrentPosition(vm.getStartLocation);
	} else {
		alert('Browser not supported');
	}

	vm.menuStatus = ko.observable('closed');

	/* Toggle menu nav-bar open and closed */
	vm.openMenu = function() {
		if (vm.menuStatus() == 'closed') {
			vm.menuStatus('open');
			$('.icon').text('<');
		} else {
			vm.menuStatus('closed');
			$('.icon').text('>');
		}
	};

	vm.openMenu();

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
			vm.journey(new Journey(vm.startPlace, vm.finishPlace));

			vm.journey().getRoute(vm.startPlace().latLng(), vm.finishPlace().latLng(), vm.directionsCallback);
		}
	});

	directionsDisplay.addListener('directions_changed', function() {
		var directionsRoute = directionsDisplay.getDirections();

		if (!directionsRoute.hasOwnProperty('notFromDrag')) {
			vm.journey().loadRoute(directionsRoute);
		}
	});

	vm.dayLength = ko.computed(function(){
	/*	if (vm.journey() && vm.startPlace().sun && vm.finishPlace().sun) {
			$('.info').toggleClass('hidden', false);
			return (vm.finishPlace().sun.sunset.getTime() - vm.startPlace().sun.sunset.getTime()) / 60000;
	*/	}
	);

	/* Variables for weather section display */
	vm.conditionImg = ko.observable('');
	vm.currentCondition = ko.observable('');
	vm.currentTemp = ko.observable('');
	vm.maxTemp = ko.observable('');
	vm.minTemp = ko.observable('');

	/* Display neighborhood weather in nav bar */
	vm.displayWeather = function(weather) {
		vm.conditionImg('http://' + weather.current.condition.icon);
		vm.currentCondition(weather.current.condition.text);
		vm.currentTemp(weather.current.temp_f + '°F');
		vm.maxTemp(weather.forecast.forecastday[0].day.maxtemp_f + '°F');
		vm.minTemp(weather.forecast.forecastday[0].day.mintemp_f + '°F');
	};

	var autocompleteStart = new google.maps.places.Autocomplete($('.start .field')[0]);
	var autocompleteFinish = new google.maps.places.Autocomplete($('.finish .field')[0]);
	var autocompleteAlert = new google.maps.places.Autocomplete($('.alert-window .field')[0]);
	
	autocompleteStart.bindTo('bounds', map);
	autocompleteFinish.bindTo('bounds', map);

};

/* Declare variables that need to be global (mostly necessary due to callback functions) */
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