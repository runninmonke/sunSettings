/*global $, google, ko*/
'use strict';

/*eslint-disable quotes*/
/* Template used format data into infoWindow DOM elements */
var contentTemplate = {
	sun: '<p>Sunrise: %sunrise%<br>Solar noon: %noon%<br>Sunset: %sunset%</p>',
	name: '<h3>%text%</h3>',
	start: "<div class='info-window'>",
	end: '</div>'
};
/*eslint-enable quotes*/

/* Place class to create all the place objects for the map */
var Place = function(data) {
	var self = this;

	self.address = ko.observable();
	self.latLng = ko.observable();
	
	/* Assigns to observable if it exists, otherwise regular assignment */
	for (var item in data) {
		if (data.hasOwnProperty(item)) {
			self[item] ? self[item](data[item]) : self[item] = data[item];
		}
	}

	self.active = ko.observable(true);
	self.status = ko.observable('deselected');

	/* Loading message in case content is slow to build */
	self.content = 'Loading...';

	/* Get missing address or LatLng. Skip to creating mark if both already present */
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
	/* Set self = this as a way to make the object's methods available to the callback function. This strategy used in other methods as well */
	var self = this;
	geocoder.geocode(data, function(results, status) {
		if (status == google.maps.GeocoderStatus.OK) {
			self.address(results[0].formatted_address);
			self.latLng(results[0].geometry.location);
			self.latLngOut = self.latLng().lat().toString().slice(0,9);
			self.latLngOut += ', ' + self.latLng().lng().toString().slice(0,9);
			map.setCenter(self.latLng());
			self.createMarker();
		} else {
			alert('Location data unavailable. Geocoder failed:' + status);
		}
	});
};

/* Use latLng data to create map marker and get additional details */
Place.prototype.createMarker = function() {
	var self = this;

	/* Create map marker */
	self.marker = new google.maps.Marker({
		position: self.latLng(),
		map: map,
		title: self.name
	});

	/* Remove marker from map if place not active */
	if (!self.active()) {
		self.marker.setMap(null);
	}

	/* Allow selected place to be changed by clicking map markers */
	self.marker.addListener('click', function() {
		vm.changePlace(self);
	});

};

Place.prototype.getWeather = function() {
	/* Use an API to get weather info and call function to calculate the local time offset from UTC **/
	$.getJSON('https://api.apixu.com/v1/forecast.json?key=f7fc2a0c018f47c688b200705150412&q=' + this.latLng.lat() + ',' + this.latLng.lng(), function(results) {
		this.weather = results;
		if (!this.weather.hasOwnProperty('error')) {
			this.calcTimeOffset();
			vm.displayWeather();
		}
	}).fail(function() {
		alert('Local time and weather data not available');
	});

};

	/* Search immediate vicinity to see if location is in Google Places and get details, might use for to get directions. 
	detailService.nearbySearch({
			location: self.latLng,
			radius: IMMEDIATE_SEARCH_RADIUS,
			name: self.name
		}, function(results, status) {
			if (status == google.maps.places.PlacesServiceStatus.OK) {
				self.details = results[0];
				console.log(results[0]);
			}
	});
	*/

/* Check for what data has been successfully retrieved and build content for infoWindow by plugging it into the template */
Place.prototype.buildContent = function() {
	this.content = contentTemplate.start;
	this.content += contentTemplate.name.replace('%text%', this.name);

	/* Use google streetview image if no place photo exists
	if (!this.photoUrl) {
		this.photoUrl = 'https://maps.googleapis.com/maps/api/streetview?fov=120&key=AIzaSyB7LiznjiujsNwqvwGu7jMg6xVmnVTVSek&size=' +
			INFO_PHOTO.maxWidth + 'x' + INFO_PHOTO.maxHeight + '&location=' + this.address;
	}

	this.content += contentTemplate.photo.replace('%src%', this.photoUrl).replace('%alt%', 'Photo of ' + this.name);
	*/

	if (this.hasOwnProperty('sun')) {
		this.content += contentTemplate.sun.replace('%sunrise%', this.sun.rise).replace('%noon%', this.sun.noon).replace('%sunset%', this.sun.set);
	}

	this.content += contentTemplate.end;

	/* Update infoWindow content when done if currently selected */
	if (this.status() == 'selected') {
		infoWindow.setContent(this.content);
	}
};

Place.prototype.activate = function() {
	if (!this.active()) {
		this.active(true);
		this.marker.setMap(map);
		if (this.status() == 'selected') {
			this.marker.setAnimation(google.maps.Animation.BOUNCE);
		}
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


Place.prototype.select = function() {
	var self = this;
	self.status('selected');

	/* Adjust map marker and infoWindow to show place is selected */
	if (self.hasOwnProperty('marker')) {
		self.marker.setAnimation(google.maps.Animation.BOUNCE);
		infoWindow.setContent(self.content);
		infoWindow.open(map, self.marker);
	}
};

Place.prototype.deselect = function() {
	this.status('deselected');
	this.marker.setAnimation(null);
};

Place.prototype.displayText = function() {
	/* Display address if available */
	if (this.address()) {
		return this.address();
	} else if (this.latLngOut) {
		return this.latLngOut;
	}
}

var viewModel = function() {
	vm = this;

	vm.showAlert = ko.observable(true);
	vm.alertMessage = ko.observable('Allow geolocation or enter starting location:');
	$('.alert-window .field').focus();

	vm.startPlace = ko.observable();
	vm.startPlaceField = ko.computed({
		read: function(){
			/* Remove alert window if place looks valid and therfore map should be loaded*/ 
			if (vm.startPlace() && vm.startPlace().latLng() && vm.showAlert()) {
				vm.showAlert(false);
			}

			if (vm.startPlace()) {
				return vm.startPlace().displayText();
			}
		},
		write: function(){
		},
		owner: this
	});

	vm.finishPlace = ko.observable();
	vm.finishPlaceField = ko.computed({
		read: function(){
			if (vm.finishPlace()) {
				return vm.finishPlace().displayText();
			}
		},
		write: function(){
		},
		owner: this
	});

	vm.loadStart = function() {
		vm.startPlace(new Place({address: $('.alert-window .field')[0].value}));
	};

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


	vm.loadStartLocation = function(position) {
		if (position) {
			var latLng = new google.maps.LatLng(position.coords.latitude, position.coords.longitude);
			
			if (latLng.lat() < 90 && latLng.lat() > -90) {
				map.setCenter(latLng);
			}

			if (map.getCenter()) {
				vm.startPlace(new Place({name: 'Start', latLng: latLng}));
			} else {
				vm.alertMessage('Error with geolocation. Enter starting location:');
			}
		}
	};

	if (navigator.geolocation) {
		navigator.geolocation.getCurrentPosition(vm.loadStartLocation);
	} else {
		alert('Browser not supported');
	}

	/* Increase map zoom level on large displays */
	if (window.matchMedia('(min-width: 700px)').matches) {
		map.setZoom(12);
	}


	/* Toggle or change selected place */
	vm.changePlace = function(place) {
		if (typeof vm.selectedPlace() == 'object') {
			vm.selectedPlace().deselect();
			if (place === vm.selectedPlace()) {
				vm.selectedPlace = ko.observable();
				infoWindow.close();
				return;
			}
		}
		vm.selectedPlace(place);
		vm.selectedPlace().select();

		/* Allow default click action as well by returning true */
		return true;
	};

	/* Call function depending on status of the search button */
	vm.submitStart = function() {
		if (vm.startPlace()) {
			vm.startPlace().deactivate();
		}
		vm.startPlace(new Place({address: $('.start .field')[0].value, name: 'Start'}));
	};

	vm.submitFinish = function() {
		if (vm.finishPlace()) {
			vm.finishPlace().deactivate();
		}
		vm.finishPlace(new Place({address: $('.finish .field')[0].value, name: 'Finish'}));
	};

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
var infoWindow;
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

	/* Initiate the various google maps objects that will be used */
	geocoder = new google.maps.Geocoder();
	infoWindow = new google.maps.InfoWindow();

	/* Initialize direction services */
	directionsService = new google.maps.DirectionsService();
	directionsDisplay = new google.maps.DirectionsRenderer();
	directionsDisplay.setMap(map);

	/* Initiate the View-model */
	ko.applyBindings(new viewModel());
};