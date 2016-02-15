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
	self.time = new Date();

	/* Display latLng if no address */
	self.displayText = ko.computed({
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

	self.active = ko.observable(true);
	self.status = 'deselected';

	/* Loading message in case content is slow to build */
	self.content = 'Loading...';

	self.infoWindow = new google.maps.InfoWindow();
	
	/* Assigns to observable if it exists, otherwise regular assignment */
	for (var item in data) {
		if (data.hasOwnProperty(item)) {
			self[item] ? self[item](data[item]) : self[item] = data[item];
		}
	}

	/* Get missing address or LatLng. Skip to creating marker if both already present */
	if (!self.latLng() && self.address()) {
		self.getGeocodeInfo({address: self.address()});
	} else if (self.latLng() && !self.address()) {
		self.getGeocodeInfo({latLng: self.latLng()});
	} else {
		self.createMarker();
	}
};

/* Populate properties with Geocoderesults, add a marker and try to get additional details via a series of AJAX requests. */
Place.prototype.getGeocodeInfo = function(data) {
	var self = this;

	/* Request geocoder info and then call all functions dependent on the results */
	geocoder.geocode(data, function(results, status) {
		if (status == google.maps.GeocoderStatus.OK) {
			self.address(results[0].formatted_address);
			self.latLng(results[0].geometry.location);

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
		} else {
			alert('Location data unavailable. Geocoder failed:' + status);
		}
	});
};

/* Get locale weather data */
Place.prototype.getWeather = function() {
	var self = this;
	/* Use an API to get weather info*/
	$.getJSON('https://api.apixu.com/v1/forecast.json?key=f7fc2a0c018f47c688b200705150412&q=' + self.latLng().lat() + ',' + self.latLng().lng(), function(results) {
		self.weather = results;
	}).fail(function() {
		alert('Weather data not available');
	});

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
		self.resetLatLng(evt.latLng);
	});

};

/* Reset LatLng dependent attributes with new Latlng */
Place.prototype.resetLatLng = function(latLng) {
	var self = this;

	self.latLng(latLng);
	self.content = 'Loading...';
	self.getGeocodeInfo({latLng: self.latLng()});
};

Place.prototype.activate = function() {
	if (!this.active()) {
		this.active(true);
		this.marker.setMap(map);
	}
};

Place.prototype.deactivate = function() {
	if (this.active()) {
		this.active(false);
	}
	if (this.hasOwnProperty('marker')) {
		this.marker.setMap(null);
	}
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
	this.startPlace = start || ko.observable({});
	this.finishPlace = finish || ko.observable({});
};

Journey.prototype.loadRoute = function(route) {
	this.route = route;
	directionsDisplay.setDirections(route);
	this.finishPlace().time = new Date(this.startPlace().time.getTime() + this.getTravelTime());
};

Journey.prototype.getTravelTime = function() {
	if (this.hasOwnProperty('route')) {
		var travelTime = 0;
		var legs = this.route.routes[0].legs;
		for (var i = 0; i < legs.length; i++) {
			travelTime += legs[i].duration.value * 1000;
		}
		return travelTime;
	}
};

/************************/
/****** View Model ******/
/************************/
var viewModel = function() {
	vm = this;
	vm.journey = ko.observable(new Journey());

	/* Increase map zoom level on large displays */
	if (window.matchMedia('(min-width: 700px)').matches) {
		map.setZoom(12);
	}

	vm.showAlert = ko.observable(true);
	vm.alertMessage = ko.observable('Allow geolocation or enter starting location:');
	$('.alert-window .field').focus();

	vm.inputStart = function() {
		vm.journey().startPlace(new Place({name: 'Start', address: $('.alert-window .field')[0].value}));
	};

	vm.getStartLocation = function(position) {
		if (position) {
			var latLng = new google.maps.LatLng(position.coords.latitude, position.coords.longitude);
			
			map.setCenter(latLng);		
			vm.journey().startPlace(new Place({name: 'Start', latLng: latLng}));
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

	/* Call function depending on status of the search button */
	vm.submitStart = function() {
		if (vm.journey().startPlace().marker) {
			vm.journey().startPlace().deactivate();
		}
		vm.journey().startPlace(new Place({address: $('.start .field')[0].value, name: 'Start'}));
	};

	vm.submitFinish = function() {
		if (vm.journey().finishPlace().marker) {
			vm.journey().finishPlace().deactivate();
		}
		vm.journey().finishPlace(new Place({address: $('.finish .field')[0].value, name: 'Finish'}));
	};

	/* Loads new route when Google LatLng objects are loaded for both start and finish places */
	vm.getRoute = ko.computed(function() {
		if (vm.journey().startPlace().latLng && vm.journey().finishPlace().latLng && vm.journey().startPlace().latLng() && vm.journey().finishPlace().latLng()) {
			var data = {
				origin: vm.journey().startPlace().latLng(),
				destination: vm.journey().finishPlace().latLng(),
				travelMode: google.maps.TravelMode.DRIVING
			};
			
			directionsService.route(data, function(result, status) {
				if (status == google.maps.DirectionsStatus.OK) {
					vm.journey().loadRoute(result);		
				} else {
					alert('Directions unavailable: ' + status);
					if (vm.journey().route) {
						delete vm.journey().route;
						directionsDisplay.set('directions', null);
					}
				}
			});
		}
	});

	vm.dayLength = ko.computed(function(){
		if (vm.journey().route && vm.journey().startPlace().sun && vm.journey().finishPlace().sun) {
			$('.info').toggleClass('hidden', false);
			return (vm.journey().finishPlace().sun.sunset.getTime() - vm.journey().startPlace().sun.sunset.getTime()) / 60000;
		}
	});

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
	directionsDisplay = new google.maps.DirectionsRenderer({map: map, suppressMarkers: true});
	/* Initiate the View-model */
	ko.applyBindings(new viewModel());
};