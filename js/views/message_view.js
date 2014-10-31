var Whisper = Whisper || {};

(function () {
  'use strict';
  moment.locale('en');

  Whisper.MessageView = Backbone.View.extend({
    tagName:   "li",
    className: "entry",

    initialize: function() {
      this.$el.addClass(this.model.get('type'));

      this.template = $('#message').html();
      Mustache.parse(this.template);

      this.listenTo(this.model, 'change',  this.render); // auto update
      this.listenTo(this.model, 'destroy', this.remove); // auto update

    },

    render: function() {
      this.$el.html(
        Mustache.render(this.template, {
          message: this.model.get('body'),
          timestamp: this.formatTimestamp(),
          attachments: this.model.get('attachments'),
          bubble_class: this.model.get('type') === 'outgoing' ? 'sent' : 'incoming',
          sender: this.model.thread().get('type') === 'group' ? this.model.get('person') : ''
        })
      );

      return this;
    },

    formatTimestamp: function() {
      var timestamp = this.model.get('timestamp');
      return moment(timestamp).fromNow();
    }
  });

})();
